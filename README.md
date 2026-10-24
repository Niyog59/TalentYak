# TalentYak

A fitness coaching platform connecting Nepali coaches with clients abroad.

I designed and built TalentYak as the sole developer. The project covers the application interface, relational data model, authentication, coaching workflows, payments integration, and background processing.

[Visit TalentYak](https://talentyak.com) · [Technical overview](docs/PORTFOLIO.md)

## What the application supports

- Coach offers and client enrollment.
- Coaching programmes, check-ins, and progress records.
- Private communication between clients and coaches.
- Payment-event processing and financial records.
- Background jobs for notifications and operational tasks.
- Administrative workflows for managing the platform.

## Engineering decisions

**Access rules belong in the database.** PostgreSQL row-level security controls access to records, with database tests covering different user roles.

**Money is stored in integer minor units.** Currency precision and rounding are handled explicitly, with tests for calculations and allocations.

**Payment processing must tolerate repeated delivery.** The webhook implementation verifies Stripe signatures, records event receipts, and handles duplicate processing and retries.

**Background work must survive the request that created it.** Jobs are recorded in a database-backed outbox before workers attempt delivery.

## Stack

Next.js · React · TypeScript · Supabase/PostgreSQL · Stripe · Vercel

## Run locally

Start from the repository root:

```bash
cd web
npm ci
cp .env.example .env.local
npm run dev
```

Configure `.env.local` using the example file and the [configuration guide](docs/operations/configuration.md). Keep credentials out of Git.

## Check the application

From the `web` directory:

```bash
npm run verify
npm run build
```

The verification command generates the Next.js types before running the project checks. The verification command runs the checks defined in [`web/package.json`](web/package.json). A successful unit check does not establish that external services or database integration tests have passed.

## Database integration tests

Database tests require a separate test environment and appropriate credentials. Use the [database guide](docs/operations/database-and-migrations.md) before running them. Do not point test fixtures or migrations at a live customer database.

## Project status

The public website and the repository demonstrate the product and its implementation. Live payment acceptance, service activation, and external integrations depend on the deployment configuration.

## Documentation

- [Technical overview](docs/PORTFOLIO.md)
- [Architecture](ARCHITECTURE.md)
- [Configuration](docs/operations/configuration.md)
- [Database and migrations](docs/operations/database-and-migrations.md)
- [Payments and payouts](docs/operations/payments-and-payouts.md)
- [Launch runbook](docs/operations/launch-runbook.md)
