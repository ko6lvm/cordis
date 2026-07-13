#!/bin/bash

# Exit on any error
set -e

echo "=========================================="
echo "Installing PostgreSQL and packages..."
echo "=========================================="
sudo apt update
sudo apt install postgresql postgresql-contrib -y

echo "=========================================="
echo "Ensuring PostgreSQL is running..."
echo "=========================================="
sudo systemctl start postgresql
sudo systemctl enable postgresql

echo "=========================================="
echo "Creating database and user..."
echo "=========================================="

# Create the database if it doesn't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'cordis'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE cordis;"

# Create the user if it doesn't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = 'cordis_user'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER cordis_user WITH PASSWORD 'ksfWebServices';"

# Grant permissions
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE cordis TO cordis_user;"

echo "=========================================="
echo "PostgreSQL initialization completed!"
echo "=========================================="
