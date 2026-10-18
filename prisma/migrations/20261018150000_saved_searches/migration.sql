-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "query" TEXT NOT NULL,
    "field" TEXT NOT NULL DEFAULT 'smart',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_query_field_key" ON "SavedSearch"("query", "field");

