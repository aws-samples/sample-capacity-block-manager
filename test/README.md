# API Testing Scripts

This directory contains scripts for testing the Capacity Block Manager API.

## Available Scripts

### `test_api_operations.py`

A comprehensive test script that:
- Tests all API operations (GET, POST, PUT, DELETE, PATCH)
- Creates test entries with a unique timestamp identifier
- Verifies each operation works correctly
- Cleans up all test data after completion
- Reports success/failure for each operation

#### Usage

```bash
# Make sure you have the required dependencies
pip install -r requirements.txt

# Run the test script
python test_api_operations.py
```

### `seed_test_data.py`

The original script that seeds the DynamoDB table with test data.
This script does not clean up after itself and is intended for development purposes.

#### Usage

```bash
# Make sure you have the required dependencies
pip install -r requirements.txt

# Run the seed script
python seed_test_data.py
```

## Requirements

See `requirements.txt` for the required Python packages.

## Notes

- Both scripts require AWS credentials with appropriate permissions
- The test script uses mock capacity block IDs to avoid requiring actual capacity blocks
- All test entries are prefixed with a timestamp to ensure uniqueness
