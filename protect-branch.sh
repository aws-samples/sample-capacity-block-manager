#!/bin/bash

# This script protects the main branch using GitHub API
# You need to set GITHUB_TOKEN environment variable with a token that has admin permissions

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN environment variable is not set"
  echo "Please set it with a GitHub token that has admin permissions for the repository"
  echo "Example: export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx"
  exit 1
fi

REPO="aws-samples/sample-capacity-block-manager"
BRANCH="main"

# Create branch protection rule
curl -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/$REPO/branches/$BRANCH/protection \
  -d '{
    "required_status_checks": {
      "strict": true,
      "contexts": ["Node.js CI"]
    },
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "dismissal_restrictions": {},
      "dismiss_stale_reviews": true,
      "require_code_owner_reviews": true,
      "required_approving_review_count": 1
    },
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false
  }'

echo "Branch protection rule created for $BRANCH branch in $REPO repository"
