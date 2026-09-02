# Property Master News Agent

GitHub Actions automation that scans configured publisher pages, validates metadata, deduplicates, and publishes city-routed news to Property Master. No OpenAI API key is required.

## Schedule

Runs every five minutes, the shortest interval supported for scheduled GitHub Actions workflows. It can also be started manually in dry-run mode.

## Deployment

1. Create a private GitHub repository and push this folder to its default branch.
2. Open **Actions → Publish Property Master news → Run workflow** and keep **dry_run** enabled for the first run.
3. Review the uploaded `run-report.json` artifact. Then run once with dry-run disabled.
4. Scheduled publishing will run automatically every five minutes, even when your computer is off.

The workflow sends `createdAt` as the current UTC ISO-8601 timestamp and rejects API responses where it is missing. Published fingerprints are committed to `data/fingerprints.json` to prevent repeat submissions.

Approved publisher/channel pages are configured in `sources.json`. Seed article links are represented by their publisher's current news or city page so the crawler discovers newer stories. Social-media shares, Google-share redirects, invitations, podcasts, crime, and unsupported-city stories are intentionally excluded.

## Optional configuration

Change `OPENAI_MODEL` or `PROPERTY_MASTER_API_URL` in `.github/workflows/publish-news.yml`. The endpoint currently needs no authorization header; add a GitHub secret and header if the backend later requires one.
