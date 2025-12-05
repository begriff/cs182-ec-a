#!/usr/bin/env python3
"""
Fetch all threads from an Ed course.
Requires ED_API_TOKEN in .env file.
"""

import json
from edapi import EdAPI


FILTER_TEXT = "special participation a"


def fetch_all_threads(course_id: int, batch_size: int = 100) -> list[dict]:
    """
    Fetch all threads from a course using pagination.
    
    Args:
        course_id: The Ed course ID
        batch_size: Number of threads to fetch per request (max 100)
    
    Returns:
        List of all thread dictionaries
    """
    ed = EdAPI()
    ed.login()
    
    all_threads = []
    offset = 0
    
    while True:
        threads = ed.list_threads(
            course_id=course_id,
            limit=batch_size,
            offset=offset,
            sort="new"
        )
        
        if not threads:
            break
            
        all_threads.extend(threads)
        print(f"Fetched {len(all_threads)} threads so far...")
        
        # If we got fewer than batch_size, we've reached the end
        if len(threads) < batch_size:
            break
            
        offset += batch_size
    
    return all_threads


def thread_contains_text(thread: dict, text: str) -> bool:
    """Check if thread title or content contains the text (case-insensitive)."""
    text_lower = text.lower()
    title = thread.get('title', '').lower()
    content = thread.get('content', '').lower()
    return text_lower in title or text_lower in content


def main():
    course_id = 84647
    output_file = "threads.json"
    
    print(f"Fetching all threads from course {course_id}...")
    all_threads = fetch_all_threads(course_id)
    print(f"Total threads fetched: {len(all_threads)}")
    
    # Filter threads containing the target text
    filtered_threads = [
        t for t in all_threads 
        if thread_contains_text(t, FILTER_TEXT)
    ]
    
    print(f"Threads matching '{FILTER_TEXT}': {len(filtered_threads)}")
    
    # Save to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(filtered_threads, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(filtered_threads)} threads to {output_file}")
    
    # Print summary
    print("\n" + "=" * 60)
    for thread in filtered_threads:
        print(f"#{thread.get('number', 'N/A')} | {thread.get('type', 'unknown').upper()}")
        print(f"Title: {thread.get('title', 'No title')}")
        print("-" * 60)


if __name__ == "__main__":
    main()

