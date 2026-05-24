CREATE TABLE IF NOT EXISTS servers (
    server_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    ip VARCHAR(64),
    cpu_cores INT,
    cpu_physical_cores INT,
    ram_total_gb DOUBLE PRECISION,
    os VARCHAR(80),
    architecture VARCHAR(80),
    note TEXT,
    cpu DOUBLE PRECISION,
    ram DOUBLE PRECISION,
    disk DOUBLE PRECISION,
    ram_used_gb DOUBLE PRECISION,
    ram_available_gb DOUBLE PRECISION,
    uptime VARCHAR(120),
    registered_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_registered TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    last_updated TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS server_metadata (
    server_id VARCHAR(64) PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
    display_name VARCHAR(120),
    specifications TEXT,
    price_per_month DOUBLE PRECISION NOT NULL DEFAULT 0,
    description TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rentals (
    rental_id VARCHAR(64) PRIMARY KEY,
    server_id VARCHAR(64) NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    server_name VARCHAR(120),
    server_ip VARCHAR(64),
    username VARCHAR(120),
    private_key TEXT,
    status VARCHAR(32) NOT NULL,
    renter_name VARCHAR(120),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMP,
    cancel_requested_at TIMESTAMP,
    cancelled_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id VARCHAR(64) PRIMARY KEY,
    rental_id VARCHAR(64),
    server_id VARCHAR(64) NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL,
    username VARCHAR(120),
    public_key TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    picked_at TIMESTAMP,
    finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_server_pending
ON tasks (server_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_rentals_server
ON rentals (server_id, status, created_at);
