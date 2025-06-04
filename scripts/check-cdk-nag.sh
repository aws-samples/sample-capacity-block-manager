#!/bin/bash
# Script to run cdk-nag checks on the stack

# Ensure the script exits on any error
set -e

echo "Running CDK synth with cdk-nag checks..."
npx cdk synth

echo "Checking for cdk-nag warnings and errors in the output..."
if grep -q "AwsSolutions-" cdk.out/CapacityBlockManagerStack.template.json; then
  echo "⚠️ cdk-nag found potential issues. Review the warnings above."
  echo "For detailed information, check the cdk.out directory."
  exit 1
else
  echo "✅ No cdk-nag issues found!"
  exit 0
fi
