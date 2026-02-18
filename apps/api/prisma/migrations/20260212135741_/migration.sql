-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trial_active', 'trial_expired', 'paid');

-- CreateEnum
CREATE TYPE "FocusStatus" AS ENUM ('active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "FocusRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('todo', 'in_progress', 'done', 'canceled');

-- CreateEnum
CREATE TYPE "SubTaskStatus" AS ENUM ('todo', 'done');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('link', 'file');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('queued', 'sent', 'failed', 'skipped_quiet_hours');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tg_id" BIGINT NOT NULL,
    "username" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "user_id" TEXT NOT NULL,
    "trial_started_at" TIMESTAMP(3) NOT NULL,
    "trial_expires_at" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "blocked_reason" TEXT,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "Focus" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT,
    "deadline_at" TIMESTAMP(3),
    "success_metric" TEXT,
    "budget" DOUBLE PRECISION,
    "niche" TEXT,
    "status" "FocusStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Focus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusMember" (
    "focus_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "FocusRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusMember_pkey" PRIMARY KEY ("focus_id","user_id")
);

-- CreateTable
CREATE TABLE "FocusInvite" (
    "id" TEXT NOT NULL,
    "focus_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "max_uses" INTEGER,
    "uses_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FocusInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "focus_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "assigned_to_user_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'medium',
    "status" "TaskStatus" NOT NULL DEFAULT 'todo',
    "due_at" TIMESTAMP(3),
    "remind_policy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTask" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SubTaskStatus" NOT NULL DEFAULT 'todo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "url" TEXT,
    "tg_file_id" TEXT,
    "file_name" TEXT,
    "mime" TEXT,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KPI" (
    "id" TEXT NOT NULL,
    "focus_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "target_value" DOUBLE PRECISION,
    "current_value" DOUBLE PRECISION,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KPI_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantThread" (
    "id" TEXT NOT NULL,
    "focus_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSettings" (
    "user_id" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Helsinki',
    "quiet_hours" JSONB,
    "no_due_nudge" JSONB,
    "default_due_offsets" JSONB,
    "enabled_types" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSettings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "focus_id" TEXT,
    "event_name" TEXT NOT NULL,
    "props" JSONB,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tg_id_key" ON "User"("tg_id");

-- CreateIndex
CREATE INDEX "Focus_owner_user_id_idx" ON "Focus"("owner_user_id");

-- CreateIndex
CREATE INDEX "FocusMember_user_id_idx" ON "FocusMember"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "FocusInvite_code_key" ON "FocusInvite"("code");

-- CreateIndex
CREATE INDEX "FocusInvite_focus_id_idx" ON "FocusInvite"("focus_id");

-- CreateIndex
CREATE INDEX "Task_focus_id_idx" ON "Task"("focus_id");

-- CreateIndex
CREATE INDEX "Task_assigned_to_user_id_idx" ON "Task"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_due_at_idx" ON "Task"("due_at");

-- CreateIndex
CREATE INDEX "SubTask_task_id_idx" ON "SubTask"("task_id");

-- CreateIndex
CREATE INDEX "TaskComment_task_id_idx" ON "TaskComment"("task_id");

-- CreateIndex
CREATE INDEX "TaskComment_author_user_id_idx" ON "TaskComment"("author_user_id");

-- CreateIndex
CREATE INDEX "TaskAttachment_task_id_idx" ON "TaskAttachment"("task_id");

-- CreateIndex
CREATE INDEX "KPI_focus_id_idx" ON "KPI"("focus_id");

-- CreateIndex
CREATE INDEX "AssistantThread_focus_id_idx" ON "AssistantThread"("focus_id");

-- CreateIndex
CREATE INDEX "AssistantMessage_thread_id_idx" ON "AssistantMessage"("thread_id");

-- CreateIndex
CREATE INDEX "NotificationLog_user_id_idx" ON "NotificationLog"("user_id");

-- CreateIndex
CREATE INDEX "NotificationLog_created_at_idx" ON "NotificationLog"("created_at");

-- CreateIndex
CREATE INDEX "EventLog_ts_idx" ON "EventLog"("ts");

-- CreateIndex
CREATE INDEX "EventLog_event_name_ts_idx" ON "EventLog"("event_name", "ts");

-- CreateIndex
CREATE INDEX "EventLog_user_id_ts_idx" ON "EventLog"("user_id", "ts");

-- CreateIndex
CREATE INDEX "EventLog_focus_id_ts_idx" ON "EventLog"("focus_id", "ts");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Focus" ADD CONSTRAINT "Focus_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusMember" ADD CONSTRAINT "FocusMember_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusMember" ADD CONSTRAINT "FocusMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusInvite" ADD CONSTRAINT "FocusInvite_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTask" ADD CONSTRAINT "SubTask_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KPI" ADD CONSTRAINT "KPI_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSettings" ADD CONSTRAINT "ReminderSettings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLog" ADD CONSTRAINT "EventLog_focus_id_fkey" FOREIGN KEY ("focus_id") REFERENCES "Focus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
