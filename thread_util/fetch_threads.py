#!/usr/bin/env python3
"""
Fetch all threads from an Ed course.
Requires ED_API_TOKEN in .env file.
"""

import json
import re
from pathlib import Path

import requests
from edapi import EdAPI
import fitz  # PyMuPDF


FILTER_TEXT = "special participation a"
FILES_DIR = Path(__file__).parent.parent / "special_participation_site" / "files"


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
    """Check if thread title contains the text (case-insensitive)."""
    title = thread.get('title', '').lower()
    return text.lower() in title


def extract_files_from_content(content: str) -> list[dict]:
    """
    Extract file URLs and filenames from thread content XML.
    
    Returns:
        List of dicts with 'url' and 'filename' keys
    """
    # Match <file url="..." filename="..."/> elements
    pattern = r'<file\s+url="([^"]+)"\s+filename="([^"]+)"\s*/>'
    matches = re.findall(pattern, content)
    return [{'url': url, 'filename': filename} for url, filename in matches]


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for filesystem compatibility."""
    # Replace problematic characters
    sanitized = re.sub(r'[<>:"/\\|?*]', '_', filename)
    # Remove any leading/trailing whitespace or dots
    sanitized = sanitized.strip('. ')
    return sanitized


def download_file(url: str, dest_path: Path) -> bool:
    """
    Download a file from URL to destination path.
    
    Returns:
        True if download succeeded, False otherwise
    """
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        dest_path.write_bytes(response.content)
        return True
    except Exception as e:
        print(f"  Error downloading {url}: {e}")
        return False


def pdf_to_text(pdf_path: Path) -> str:
    """
    Extract text from a PDF file using PyMuPDF.
    
    Returns:
        Extracted text content
    """
    text_parts = []
    try:
        doc = fitz.open(pdf_path)
        for page_num, page in enumerate(doc, 1):
            page_text = page.get_text()
            if page_text.strip():
                text_parts.append(f"--- Page {page_num} ---\n{page_text}")
        doc.close()
    except Exception as e:
        print(f"  Error extracting text from {pdf_path}: {e}")
        return ""
    return "\n\n".join(text_parts)


def process_thread_files(thread: dict, files_dir: Path) -> list[dict]:
    """
    Download files from a thread and convert PDFs to text.
    
    Args:
        thread: Thread data dictionary
        files_dir: Absolute path to the files directory
    
    Returns:
        List of file info dicts with relative paths and transcript status
    """
    content = thread.get('content', '')
    files = extract_files_from_content(content)
    
    if not files:
        return []
    
    thread_num = thread.get('number', 'unknown')
    thread_dir = files_dir / f"thread_{thread_num}"
    thread_dir.mkdir(parents=True, exist_ok=True)
    
    processed_files = []
    
    for file_info in files:
        filename = sanitize_filename(file_info['filename'])
        file_path = thread_dir / filename
        
        print(f"  Downloading: {filename}")
        if not download_file(file_info['url'], file_path):
            continue
        
        # Use simple relative path for the manifest (relative to special_participation_site)
        relative_path = f"files/thread_{thread_num}/{filename}"
        
        file_record = {
            'original_filename': file_info['filename'],
            'saved_as': relative_path,
            'url': file_info['url'],
            'transcript': None
        }
        
        # Convert PDF to text
        if filename.lower().endswith('.pdf'):
            print(f"  Extracting text from PDF: {filename}")
            text = pdf_to_text(file_path)
            if text:
                transcript_path = file_path.with_suffix('.txt')
                transcript_path.write_text(text, encoding='utf-8')
                transcript_filename = filename.rsplit('.', 1)[0] + '.txt'
                file_record['transcript'] = f"files/thread_{thread_num}/{transcript_filename}"
                print(f"  Saved transcript: {transcript_path.name}")
        
        processed_files.append(file_record)
    
    return processed_files


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
    
    # Create files directory
    FILES_DIR.mkdir(exist_ok=True)
    
    # Process files for each thread
    print("\n" + "=" * 60)
    print("Processing attached files...")
    print("=" * 60)
    
    files_manifest = {}
    
    for thread in filtered_threads:
        thread_num = thread.get('number', 'unknown')
        thread_title = thread.get('title', 'No title')
        
        # Check if thread has files
        content = thread.get('content', '')
        files_in_content = extract_files_from_content(content)
        
        if files_in_content:
            print(f"\nThread #{thread_num}: {thread_title}")
            print(f"  Found {len(files_in_content)} file(s)")
            
            processed = process_thread_files(thread, FILES_DIR)
            if processed:
                files_manifest[str(thread_num)] = {
                    'thread_id': thread.get('id'),
                    'thread_title': thread_title,
                    'files': processed
                }
    
    # Save files manifest
    manifest_path = FILES_DIR / "manifest.json"
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(files_manifest, f, indent=2, ensure_ascii=False)
    print(f"\nSaved files manifest to {manifest_path}")
    
    # Save threads to JSON
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(filtered_threads, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(filtered_threads)} threads to {output_file}")
    
    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    total_files = sum(len(m['files']) for m in files_manifest.values())
    total_transcripts = sum(
        1 for m in files_manifest.values() 
        for f in m['files'] 
        if f['transcript']
    )
    print(f"Threads processed: {len(filtered_threads)}")
    print(f"Files downloaded: {total_files}")
    print(f"PDF transcripts created: {total_transcripts}")
    
    print("\nThreads:")
    for thread in filtered_threads:
        print(f"  #{thread.get('number', 'N/A')} | {thread.get('title', 'No title')[:50]}")


if __name__ == "__main__":
    main()

