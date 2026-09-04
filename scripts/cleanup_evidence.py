#!/usr/bin/env python3
"""Clean up all qc_evidence files from CodeChronoBullet assets"""
import os
from pathlib import Path

root = Path('D:/Projects/CodeChronoBullet/assets')
count = 0
for p in root.rglob('*qc_evidence*'):
    if p.is_file():
        p.unlink()
        count += 1
print(f'Cleaned {count} qc_evidence files')
