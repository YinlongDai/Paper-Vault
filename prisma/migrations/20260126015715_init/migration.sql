-- CreateTable
CREATE TABLE "SavedPaper" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "arxivId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "absUrl" TEXT NOT NULL,
    "published" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedPaper_arxivId_key" ON "SavedPaper"("arxivId");
