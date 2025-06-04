#!/usr/bin/env python3
"""
API Test Script for Capacity Block Manager

This script tests all API operations (GET, POST, PUT, DELETE, PATCH)
and cleans up after itself to ensure no test data remains in the system.
"""

import boto3
import requests
import json
import time
import sys
from datetime import datetime, timezone, timedelta

# === CONFIG ===
STACK_NAME = 'CapacityBlockManagerStack'
SECRET_NAME = '/cbm/CapacityBlockManagerStack/apiSecretName'  # Direct secret name
API_URL_PARAM = f'/cbm/{STACK_NAME}/apiUrl'

# === INIT AWS CLIENTS ===
ssm = boto3.client('ssm')
secretsmanager = boto3.client('secretsmanager')
ec2 = boto3.client('ec2')

# === Test Data ===
TEST_ID = f"test-{int(time.time())}"
TEST_ENTRIES = [
    {
        'PK': f"{TEST_ID}-no-approval",
        'name': 'TestNoApprovalJob',
        'region': 'us-east-1',
        'instance_type': 'p4d.24xlarge',
        'capacity_block_id': 'cr-test12345',  # Mock ID
        'extend_by_days': 1,
        'require_approval': False,
        'extension_lookahead_days': 2,
        'status': 'PENDING',
        'end_time': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    },
    {
        'PK': f"{TEST_ID}-requires-approval",
        'name': 'TestRequiresApprovalJob',
        'region': 'us-east-1',
        'instance_type': 'p4de.24xlarge',
        'capacity_block_id': 'cr-test67890',  # Mock ID
        'extend_by_days': 1,
        'require_approval': True,
        'approval': False,
        'extension_lookahead_days': 2,
        'status': 'PENDING',
        'end_time': (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    }
]

# === Helper Functions ===
def get_ssm_param(name):
    """Get parameter from SSM Parameter Store"""
    try:
        return ssm.get_parameter(Name=name, WithDecryption=False)['Parameter']['Value']
    except Exception as e:
        print(f"Error retrieving SSM parameter {name}: {e}")
        sys.exit(1)

def get_api_key(secret_name):
    """Get API key from Secrets Manager"""
    try:
        response = secretsmanager.get_secret_value(SecretId=secret_name)
        return json.loads(response['SecretString'])['api_key']
    except Exception as e:
        print(f"Error retrieving API key from secret {secret_name}: {e}")
        sys.exit(1)

def print_result(operation, pk, success, status_code=None, response_text=None):
    """Print formatted result of API operation"""
    status = "✅ SUCCESS" if success else "❌ FAILED"
    details = f" ({status_code}: {response_text})" if not success else ""
    print(f"{status} | {operation} | {pk}{details}")

# === Main Test Function ===
def run_api_tests():
    """Run all API tests and clean up"""
    # Get API details
    print("Retrieving API details...")
    api_url = get_ssm_param(API_URL_PARAM)
    api_key = get_api_key(SECRET_NAME)
    
    headers = {
        'x-api-key': api_key,
        'Content-Type': 'application/json'
    }
    
    print(f"\nAPI URL: {api_url}")
    print(f"Using test ID: {TEST_ID}")
    print("\n=== STARTING API TESTS ===\n")
    
    # Track created entries for cleanup
    created_entries = []
    
    try:
        # Test 1: GET all entries (baseline)
        print("\n--- Testing GET (all entries) ---")
        response = requests.get(api_url, headers=headers)
        print_result("GET all", "N/A", response.ok, response.status_code, response.text if not response.ok else None)
        if response.ok:
            baseline_count = len(response.json())
            print(f"Current entry count: {baseline_count}")
        
        # Test 2: POST new entries
        print("\n--- Testing POST (create entries) ---")
        for entry in TEST_ENTRIES:
            response = requests.post(api_url, json=entry, headers=headers)
            print_result("POST", entry['PK'], response.ok, response.status_code, response.text if not response.ok else None)
            if response.ok:
                created_entries.append(entry['PK'])
        
        # Test 3: GET specific entries
        print("\n--- Testing GET (specific entries) ---")
        for pk in created_entries:
            response = requests.get(f"{api_url}?PK={pk}", headers=headers)
            print_result("GET", pk, response.ok, response.status_code, response.text if not response.ok else None)
            if response.ok and response.json():
                print(f"Retrieved: {json.dumps(response.json(), indent=2)}")
        
        # Test 4: PUT (update) entries
        print("\n--- Testing PUT (update entries) ---")
        for pk in created_entries:
            # Get current entry
            get_response = requests.get(f"{api_url}?PK={pk}", headers=headers)
            if get_response.ok and get_response.json():
                entry = get_response.json()[0] if isinstance(get_response.json(), list) else get_response.json()
                # Update a field
                entry['name'] = f"{entry['name']}-UPDATED"
                # Send PUT request
                put_response = requests.put(api_url, json=entry, headers=headers)
                print_result("PUT", pk, put_response.ok, put_response.status_code, 
                             put_response.text if not put_response.ok else None)
        
        # Test 5: PATCH (approve) for entries that require approval
        print("\n--- Testing PATCH (approve entries) ---")
        for entry in TEST_ENTRIES:
            if entry['require_approval'] and entry['PK'] in created_entries:
                patch_data = {'PK': entry['PK'], 'approval': True}
                patch_response = requests.patch(api_url, json=patch_data, headers=headers)
                print_result("PATCH", entry['PK'], patch_response.ok, patch_response.status_code,
                             patch_response.text if not patch_response.ok else None)
        
        # Verify all operations with a final GET
        print("\n--- Final Verification ---")
        response = requests.get(api_url, headers=headers)
        if response.ok:
            final_count = len(response.json())
            print(f"Final entry count: {final_count} (Expected: {baseline_count + len(created_entries)})")
            
            # Verify our test entries exist
            test_entries = [e for e in response.json() if e['PK'].startswith(TEST_ID)]
            print(f"Found {len(test_entries)} test entries")
            
    finally:
        # Cleanup: Delete all test entries
        print("\n=== CLEANING UP ===")
        for pk in created_entries:
            print(f"Deleting test entry: {pk}")
            delete_response = requests.delete(f"{api_url}?PK={pk}", headers=headers)
            print_result("DELETE", pk, delete_response.ok, delete_response.status_code,
                         delete_response.text if not delete_response.ok else None)
        
        # Verify cleanup
        response = requests.get(api_url, headers=headers)
        if response.ok:
            remaining_test_entries = [e for e in response.json() if e['PK'].startswith(TEST_ID)]
            if remaining_test_entries:
                print(f"WARNING: {len(remaining_test_entries)} test entries still exist!")
            else:
                print("✅ All test entries successfully removed")

if __name__ == "__main__":
    run_api_tests()
