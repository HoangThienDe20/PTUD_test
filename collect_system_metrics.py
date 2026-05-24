"""
Script to continuously collect real-time system metrics and save to database.
Run this to start collecting actual CPU and memory metrics.

Usage:
    python collect_system_metrics.py
"""

import time
import requests
import os
from datetime import datetime


def collect_metrics(interval: int = 2):
    """
    Continuously collect system metrics at regular intervals.
    
    Args:
        interval: Seconds between collections (default: 2 seconds)
    """
    BASE_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
    
    print("=" * 70)
    print("🚀 SYSTEM METRICS COLLECTOR")
    print("=" * 70)
    print(f"📊 Collecting metrics every {interval} seconds...")
    print(f"🖥️  Monitor your actual CPU and RAM usage")
    print()
    
    count = 0
    
    try:
        while True:
            try:
                # Collect current metrics
                response = requests.post(f"{BASE_URL}/api/system/collect")
                
                if response.status_code == 201:
                    data = response.json()
                    count += 1
                    
                    # Display formatted output
                    cpu = data["metrics_saved"]["cpu"]
                    memory = data["metrics_saved"]["memory"]
                    timestamp = data["timestamp"]
                    
                    # Color codes for terminal
                    cpu_color = "🔴" if cpu > 80 else "🟡" if cpu > 50 else "🟢"
                    mem_color = "🔴" if memory > 80 else "🟡" if memory > 50 else "🟢"
                    
                    print(f"[{count:4d}] {timestamp} | CPU: {cpu_color} {cpu:6.2f}% | MEM: {mem_color} {memory:6.2f}%")
                else:
                    print(f"❌ Error: {response.status_code}")
                    
            except requests.exceptions.ConnectionError:
                print("❌ Cannot connect to backend. Is it running on http://localhost:8000?")
                print("   Start backend with: python -m uvicorn app.main:app --reload")
                break
            except Exception as e:
                print(f"❌ Error: {str(e)}")
                continue
            
            # Wait before next collection
            time.sleep(interval)
            
    except KeyboardInterrupt:
        print()
        print("=" * 70)
        print(f"✅ Stopped. Collected {count} metrics in total")
        print("=" * 70)


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Collect real system metrics")
    parser.add_argument(
        "--interval",
        type=int,
        default=2,
        help="Collection interval in seconds (default: 2)"
    )
    
    args = parser.parse_args()
    collect_metrics(interval=args.interval)
