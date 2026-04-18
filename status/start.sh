#!/bin/bash
cd "$(dirname "$0")"
pip install flask -q 2>/dev/null
echo "Starting Project-IQ Status Dashboard on http://0.0.0.0:9090"
python3 app.py
