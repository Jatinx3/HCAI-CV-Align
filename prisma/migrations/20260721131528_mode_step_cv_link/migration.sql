-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ModeStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "studySessionId" TEXT,
    "stepIndex" INTEGER,
    "mode" TEXT NOT NULL,
    "cvDocumentId" TEXT,
    "cvFileName" TEXT,
    "cvFormat" TEXT,
    "jdText" TEXT,
    "conservatism" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "timeToFirstActionMs" INTEGER,
    "finalCvText" TEXT,
    CONSTRAINT "ModeStep_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ModeStep_cvDocumentId_fkey" FOREIGN KEY ("cvDocumentId") REFERENCES "CvDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ModeStep" ("cvFileName", "cvFormat", "endedAt", "finalCvText", "id", "jdText", "mode", "startedAt", "stepIndex", "studySessionId", "timeToFirstActionMs") SELECT "cvFileName", "cvFormat", "endedAt", "finalCvText", "id", "jdText", "mode", "startedAt", "stepIndex", "studySessionId", "timeToFirstActionMs" FROM "ModeStep";
DROP TABLE "ModeStep";
ALTER TABLE "new_ModeStep" RENAME TO "ModeStep";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
