# Thread Utility

Fetches and filters threads from an Ed Discussion course.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Create a `.env` file

Create a `.env` file in the **project root** (parent directory) with your Ed API token:

```
ED_API_TOKEN=your_api_token_here
```

#### How to get your Ed API token

1. Log into [Ed Discussion](https://edstem.org/)
2. Go to your account settings
3. Navigate to the **API Tokens** section
4. Generate a new token and copy it

## Usage

Run the script from the `thread_util` directory:

```bash
cd thread_util
python3 fetch_threads.py
```

The script will:
1. Fetch all threads from course ID `84647`
2. Filter threads containing "special participation a" (case-insensitive)
3. Save matching threads to `threads.json`

## Configuration

To change the course ID or filter text, edit these values in `fetch_threads.py`:

```python
FILTER_TEXT = "special participation a"  # Change filter text here

def main():
    course_id = 84647  # Change course ID here
```

## Output

The script outputs a `threads.json` file containing an array of thread objects with fields like:
- `id` - Global thread ID
- `number` - Thread number within the course
- `title` - Thread title
- `content` - Thread content (HTML/XML format)
- `category`, `subcategory`, `subsubcategory` - Thread categorization
- `type` - Thread type (post, question, announcement)
- `created_at` - Creation timestamp
- `is_private`, `is_pinned`, `is_anonymous` - Status flags

