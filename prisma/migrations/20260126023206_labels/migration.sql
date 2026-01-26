-- CreateTable
CREATE TABLE "Label" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SavedPaperLabel" (
    "paperId" INTEGER NOT NULL,
    "labelId" INTEGER NOT NULL,

    PRIMARY KEY ("paperId", "labelId"),
    CONSTRAINT "SavedPaperLabel_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "SavedPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedPaperLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");
