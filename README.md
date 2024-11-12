# DexTools Backend

Backend infrastructure for DexTools, consisting of multiple services for processing and serving Kadena blockchain data.

## Architecture

The project is composed of four main modules:

- **dextools-shared**: Shared infrastructure (PostgreSQL and MongoDB databases)
- **dextools-listener**: Real-time blockchain event listener
- **dextools-cron**: Scheduled data processing jobs
- **dextools-api**: REST API service

### Module Details

#### dextools-shared

Database infrastructure with:

- PostgreSQL for transaction and candle data
- MongoDB for caching and token data

#### dextools-listener

Listens to Kadena blockchain events and processes:

- Transactions
- Price updates
- Token events

#### dextools-cron

Scheduled jobs for:

- Token updates
- Price calculations
- Performance metrics
- Account balance tracking

#### dextools-api

REST API providing:

- Account balance data
- Transaction history
- Performance metrics
- Price information

## Prerequisites

- Docker and Docker Compose
- Node.js 16+
- Git

## Installation

1. Clone the repository:

```bash
git clone https://github.com/RunOnFlux/dextools.git
cd dextools
```

2. Set up environment variables:

```bash
# Copy sample env files
cp dextools-shared/.env.example dextools-shared/.env
cp dextools-listener/.env.example dextools-listener/.env
cp dextools-cron/.env.example dextools-cron/.env
cp dextools-api/.env.example dextools-api/.env

# Edit the env files with your configuration
```

3. Start the infrastructure:

```bash
# Start shared infrastructure first
cd dextools-shared
docker-compose up -d

# Start other services
cd ../dextools-listener
docker-compose up -d

cd ../dextools-cron
docker-compose up -d

cd ../dextools-api
docker-compose up -d
```
