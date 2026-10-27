CREATE TABLE app_settings (
    setting_key VARCHAR(100) NOT NULL,
    setting_value VARCHAR(255) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (setting_key)
) ENGINE=InnoDB;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('ticket_printing_enabled', 'false', UTC_TIMESTAMP(3));
