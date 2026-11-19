-- VerifyFlow customer support conversations and messages.
CREATE TABLE IF NOT EXISTS vf_support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES vf_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ai' CHECK (status IN ('ai','human','closed')),
  subject TEXT NOT NULL DEFAULT 'Customer support',
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vf_support_conversations_user_idx
  ON vf_support_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS vf_support_conversations_status_idx
  ON vf_support_conversations(status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS vf_support_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES vf_support_conversations(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('customer','assistant','admin')),
  sender_user_id UUID REFERENCES vf_users(id) ON DELETE SET NULL,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vf_support_messages_conversation_idx
  ON vf_support_messages(conversation_id, created_at ASC);
