# Deploying the study to an Azure VM

A VM rather than App Service, for two reasons that both matter to the data:

- **SQLite gets a real disk.** App Service hands a container its persistent
  storage as an SMB share, and SQLite over SMB is the documented route to a
  corrupt database. Here the database sits on the VM's own ext4 disk.
- **No request ceiling.** App Service cuts any request at 240s on a load
  balancer that cannot be reconfigured. There is no such limit here.

Region is **swedencentral**, and it is not a free choice. The TU Dublin tenant
carries an Azure Policy, "Allowed resource deployment regions", that permits
only these five:

    italynorth  norwayeast  polandcentral  spaincentral  swedencentral

northeurope — the obvious pick for a Dublin study — is blocked, and the
deployment fails with `InvalidTemplateDeployment` and no usable detail. Sweden
is the closest of the five, and the round trip is irrelevant next to a model
call that takes tens of seconds.

Size is **Standard_D2s_v4** (2 vCPU, 8 GB). Non-burstable on purpose: the
B-series banks CPU credits and throttles once they run out, which would happen
precisely when several participants arrive together. Measured peak memory for
this app is 729 MiB, so 8 GB is roughly eleven times headroom.

v4 rather than v5 because an Azure for Students subscription has a quota of
**0** on the DSv5 family. The quotas that matter here, checked on the
subscription itself rather than assumed:

| Quota | Limit |
| --- | --- |
| Total Regional vCPUs (swedencentral) | 6 |
| Standard DSv4 Family vCPUs | 4 |
| Standard DSv5 Family vCPUs | **0** |

D2s_v4 uses 2 of each, so it fits twice over. The VM is created **non-zonal**
— no `--zone` flag. It is not required in swedencentral, which carries no zone
restrictions for this SKU, but it is required in northeurope, where every D and
B size is restricted out of zones 1 and 2; leaving the flag off works in both.

Cost is about €2.11/day.

Before any of this works, three resource providers must be registered on the
subscription. They are not registered by default and `az vm create` fails
without them:

```bash
az provider register --namespace Microsoft.Compute && az provider register --namespace Microsoft.Network && az provider register --namespace Microsoft.Storage
```

---

## 1. Build and push the image

Built for `linux/amd64` — Azure VMs are x86, and building on an Apple Silicon
laptop without `--platform` produces an arm64 image that will not start there.

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/YOUR_GITHUB_USERNAME/hcai-cv-align:study --push .
```

The package is private by default. Either make it public in GitHub → Packages →
Package settings (the source repo is already public, so the image gives nothing
away), or run `docker login ghcr.io` on the VM before starting the stack.

## 2. Create the VM

```bash
az group create --name cvapp-study --location swedencentral
```

```bash
az vm create --resource-group cvapp-study --name cvapp --image Ubuntu2404 --size Standard_D2s_v4 --admin-username azureuser --generate-ssh-keys --public-ip-sku Standard --os-disk-size-gb 64 --storage-sku Premium_LRS --public-ip-address-dns-name hcai-cv-align --custom-data deploy/azure/cloud-init.yaml
```

The flag is `--public-ip-address-dns-name`, not `--dns-name-label`; the latter
is rejected outright by az CLI 2.85. The label must be unique within the region;
if it is taken, pick another. It gives the VM the name TLS will be issued for:
`hcai-cv-align.swedencentral.cloudapp.azure.com`

Open the web ports (SSH is already open from `az vm create`):

```bash
az vm open-port --resource-group cvapp-study --name cvapp --port 80 --priority 1001
```

```bash
az vm open-port --resource-group cvapp-study --name cvapp --port 443 --priority 1002
```

## 3. Copy the stack up and fill in the secrets

```bash
scp deploy/azure/docker-compose.yml deploy/azure/Caddyfile azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com:/tmp/
```

```bash
ssh azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com
```

Then on the VM — cloud-init needs a minute or two on first boot, so if
`/opt/cvapp` is not there yet, wait and try again:

```bash
sudo mv /tmp/docker-compose.yml /tmp/Caddyfile /opt/cvapp/ && sudo cp /opt/cvapp/.env.template /opt/cvapp/.env && sudo nano /opt/cvapp/.env
```

Fill in every blank. Generate the auth secret with `openssl rand -base64 32`.
Secrets are entered here rather than in cloud-init because cloud-init is stored
in Azure instance metadata and can be read back from the portal.

## 4. Start it

```bash
cd /opt/cvapp && sudo docker compose up -d
```

Caddy requests a certificate on first start; give it thirty seconds, then:

```bash
curl -sSI https://hcai-cv-align.swedencentral.cloudapp.azure.com/login | head -1
```

`HTTP/2 200` means the app is live and TLS is valid. If it is not, read the
logs — `sudo docker compose logs caddy` and `sudo docker compose logs app`.

## 5. Create the participant logins

```bash
cd /opt/cvapp && sudo docker compose exec app npx tsx scripts/provision-batch.ts --count 20 --out /data/credentials.csv
```

```bash
sudo cp /opt/cvapp/data/credentials.csv . && sudo chown azureuser: credentials.csv
```

Then copy it down to your laptop and delete it from the VM:

```bash
scp azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com:~/credentials.csv . && ssh azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com "rm -f ~/credentials.csv /opt/cvapp/data/credentials.csv"
```

## During the study

Export the data each evening. It costs nothing and caps any loss at a day:

```bash
cd /opt/cvapp && sudo docker compose exec app npx tsx scripts/export-study.ts --out /data/export && sudo tar czf ~/study-$(date +%F).tar.gz -C /opt/cvapp/data export
```

```bash
scp azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com:~/study-*.tar.gz .
```

Watch resource use if you want reassurance during a busy session:

```bash
ssh azureuser@hcai-cv-align.swedencentral.cloudapp.azure.com "sudo docker stats --no-stream"
```

## When the study is finished

Take the final export first, then delete everything so the credit stops:

```bash
az group delete --name cvapp-study --yes --no-wait
```

Deleting the resource group removes the VM, its disk, its public IP and the
database with them. Do not run it until the export is on your laptop and you
have opened it.
