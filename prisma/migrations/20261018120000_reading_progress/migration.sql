-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SavedPaper" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "arxivId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "absUrl" TEXT NOT NULL,
    "published" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "aiSummary" TEXT,
    "links" TEXT,
    "linksCheckedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "lastPage" INTEGER,
    "pageCount" INTEGER,
    "lastZoom" REAL,
    "lastReadAt" DATETIME,
    "latestVersion" TEXT,
    "versionSeen" TEXT,
    "versionCheckedAt" DATETIME
);
INSERT INTO "new_SavedPaper" ("absUrl", "aiSummary", "arxivId", "authors", "createdAt", "id", "links", "linksCheckedAt", "note", "pdfUrl", "published", "summary", "title") SELECT "absUrl", "aiSummary", "arxivId", "authors", "createdAt", "id", "links", "linksCheckedAt", "note", "pdfUrl", "published", "summary", "title" FROM "SavedPaper";
DROP TABLE "SavedPaper";
ALTER TABLE "new_SavedPaper" RENAME TO "SavedPaper";
CREATE UNIQUE INDEX "SavedPaper_arxivId_key" ON "SavedPaper"("arxivId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

