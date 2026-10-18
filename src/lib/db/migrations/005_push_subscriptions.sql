-- Migration 005: Add Web Push Subscriptions Table
-- Stores VAPID push subscriptions per member, upsertable by endpoint.

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure group_id exists if push_subscriptions was created previously without it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'push_subscriptions' AND column_name = 'group_id'
    ) THEN
        ALTER TABLE push_subscriptions 
        ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE CASCADE;

        UPDATE push_subscriptions ps
        SET group_id = m.group_id
        FROM members m
        WHERE ps.member_id = m.id AND ps.group_id IS NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_group_id ON push_subscriptions (group_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_member_id ON push_subscriptions (member_id);
