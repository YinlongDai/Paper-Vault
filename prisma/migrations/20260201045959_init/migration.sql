-- CreateTable
CREATE TABLE "SavedPaper" (
    "id" SERIAL NOT NULL,
    "arxivId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL,
    "absUrl" TEXT NOT NULL,
    "published" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "aiSummary" TEXT,

    CONSTRAINT "SavedPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Label" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedPaperLabel" (
    "paperId" INTEGER NOT NULL,
    "labelId" INTEGER NOT NULL,

    CONSTRAINT "SavedPaperLabel_pkey" PRIMARY KEY ("paperId","labelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedPaper_arxivId_key" ON "SavedPaper"("arxivId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_name_key" ON "Label"("name");

-- AddForeignKey
ALTER TABLE "SavedPaperLabel" ADD CONSTRAINT "SavedPaperLabel_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "SavedPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedPaperLabel" ADD CONSTRAINT "SavedPaperLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
