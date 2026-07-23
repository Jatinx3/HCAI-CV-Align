import NextAuth from "next-auth";

// Edge-safe NextAuth instance: no providers, no Prisma. JWT verification only.
// Credential checks happen in the /api/auth route (Node runtime) via src/lib/auth.ts.
const { auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
});

export default auth;

export const config = {
  // Protect pages; API routes check auth() themselves and return 401 JSON
  // instead of an HTML redirect.
  matcher: ["/((?!login|api/|_next/static|_next/image|favicon.ico).*)"],
};
