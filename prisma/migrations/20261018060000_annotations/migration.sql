-- CreateTable
CREATE TABLE "Annotation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "paperId" INTEGER NOT NULL,
    "version" TEXT NOT NULL DEFAULT '',
    "page" INTEGER NOT NULL,
    "rects" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Annotation_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "SavedPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Annotation_paperId_idx" ON "Annotation"("paperId");

