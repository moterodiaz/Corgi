-- CreateTable
CREATE TABLE "GroupProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "sharedInterests" TEXT NOT NULL,
    "initiators" TEXT NOT NULL,
    "followers" TEXT NOT NULL,
    "sentimentNotes" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PersonProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "budgetSignals" TEXT NOT NULL,
    "constraints" TEXT NOT NULL,
    "availabilityMentions" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlanObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "datetime" TEXT NOT NULL,
    "costTier" TEXT NOT NULL,
    "attendees" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TranscriptBuffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupProfile_groupId_key" ON "GroupProfile"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonProfile_personId_groupId_key" ON "PersonProfile"("personId", "groupId");

-- CreateIndex
CREATE INDEX "PlanObject_groupId_planId_idx" ON "PlanObject"("groupId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanObject_planId_version_key" ON "PlanObject"("planId", "version");

-- CreateIndex
CREATE INDEX "TranscriptBuffer_groupId_idx" ON "TranscriptBuffer"("groupId");
