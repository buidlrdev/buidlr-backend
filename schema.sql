-- Buidlr Database Schema

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  privy_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255),
  wallet_address VARCHAR(42),
  credits DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ai_keys (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  provider ENUM('anthropic','openai','gemini','deepseek','groq') NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint VARCHAR(8),
  label VARCHAR(100),
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE projects (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  repo_url VARCHAR(500) NOT NULL,
  encrypted_pat TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  project_id VARCHAR(36),
  name VARCHAR(150),
  type ENUM('app','agent') DEFAULT 'app',
  status ENUM('active','stopped') DEFAULT 'active',
  container_id VARCHAR(64),
  container_port INT,
  container_status ENUM('none','running','stopped') DEFAULT 'none',
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  content LONGTEXT NOT NULL,
  file_changes JSON,
  model VARCHAR(100),
  tokens_used INT DEFAULT 0,
  credits_consumed DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE credit_transactions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type ENUM('purchase','consume') NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  tx_hash VARCHAR(66),
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE published_apps (
  id VARCHAR(36) PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  preview_url VARCHAR(500),
  custom_domain VARCHAR(255),
  tech_tags JSON,
  clone_count INT DEFAULT 0,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE templates (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  category ENUM('landing','dapp','portfolio','dashboard','ecommerce','blog','game','other') NOT NULL,
  tech_tags JSON,
  files JSON NOT NULL,
  preview_url VARCHAR(500),
  use_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better query performance
CREATE INDEX idx_ai_keys_user_id ON ai_keys(user_id);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX idx_published_apps_user_id ON published_apps(user_id);
CREATE INDEX idx_published_apps_public ON published_apps(is_public, created_at);
CREATE UNIQUE INDEX idx_custom_domain ON published_apps(custom_domain);
CREATE INDEX idx_templates_category ON templates(category, is_active);

-- Agent tables
CREATE TABLE agents (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  session_id VARCHAR(36),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  status ENUM('draft','running','paused','stopped','error') DEFAULT 'draft',
  container_id VARCHAR(64),
  agent_token VARCHAR(36),
  config JSON,
  wallet_address VARCHAR(42),
  spending_limit DECIMAL(20,8) DEFAULT 0,
  total_spent DECIMAL(20,8) DEFAULT 0,
  credits_consumed DECIMAL(20,8) DEFAULT 0,
  credit_limit DECIMAL(20,8) DEFAULT 0,
  last_heartbeat TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE TABLE agent_logs (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  level ENUM('info','warn','error','trade') NOT NULL,
  message TEXT NOT NULL,
  tx_hash VARCHAR(66),
  data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE agent_transactions (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  tx_hash VARCHAR(66) NOT NULL,
  type VARCHAR(50),
  amount DECIMAL(20,8),
  token VARCHAR(20),
  status ENUM('pending','confirmed','failed') DEFAULT 'pending',
  data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agent_logs_agent_id ON agent_logs(agent_id, created_at);
CREATE INDEX idx_agent_transactions_agent_id ON agent_transactions(agent_id);
