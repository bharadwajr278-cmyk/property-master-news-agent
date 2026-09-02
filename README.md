# Property Master News Agent

GitHub Actions automation that researches, validates, deduplicates, and publishes city-routed news to Property Master.

## Schedule

Runs every five minutes, the shortest interval supported for scheduled GitHub Actions workflows. It can also be started manually in dry-run mode.

## Deployment

1. Create a private GitHub repository and push this folder to its default branch.
2. In **Settings → Secrets and variables → Actions**, add the repository secret `OPENAI_API_KEY`.
3. Open **Actions → Publish Property Master news → Run workflow** and keep **dry_run** enabled for the first run.
4. Review the uploaded `run-report.json` artifact. Then run once with dry-run disabled.
5. Scheduled publishing will run automatically every five minutes, even when your computer is off.

The workflow sends `createdAt` as the current UTC ISO-8601 timestamp and rejects API responses where it is missing. Published fingerprints are committed to `data/fingerprints.json` to prevent repeat submissions.

## Optional configuration

Change `OPENAI_MODEL` or `PROPERTY_MASTER_API_URL` in `.github/workflows/publish-news.yml`. The endpoint currently needs no authorization header; add a GitHub secret and header if the backend later requires one.
