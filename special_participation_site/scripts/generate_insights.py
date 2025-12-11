#!/usr/bin/env python3
"""
Generate AI-powered insights about homework assignments and models.
Requires OPENAI_API_KEY in environment or .env file.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Any
from collections import defaultdict

try:
    from openai import OpenAI
except ImportError:
    print("Warning: openai package not installed. Run: pip install openai")
    OpenAI = None


def load_processed_posts(posts_path: Path) -> List[Dict[str, Any]]:
    """Load the processed posts JSON."""
    with open(posts_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def group_posts_by_homework(posts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group posts by homework ID."""
    grouped = defaultdict(list)
    for post in posts:
        hw_id = post.get('metrics', {}).get('homework_id', 'Unknown')
        if hw_id != 'Unknown':
            grouped[hw_id].append(post)
    return dict(grouped)


def group_posts_by_model(posts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group posts by model name."""
    grouped = defaultdict(list)
    for post in posts:
        model = post.get('metrics', {}).get('model_name', 'Unknown / Multiple')
        if model not in ['Unknown / Multiple', 'LLM (unspecified)']:
            grouped[model].append(post)
    return dict(grouped)


def generate_homework_insight(client: Any, hw_id: str, posts: List[Dict[str, Any]]) -> str:
    """Generate insight summary for a specific homework using LLM."""
    # Prepare summary of posts - analyze ALL posts
    summary_parts = []
    for post in posts:
        metrics = post.get('metrics', {})
        summary_parts.append(
            f"- Model: {metrics.get('model_name')}, "
            f"Focus: {metrics.get('primary_focus')}, "
            f"Depth: {metrics.get('depth_bucket')}, "
            f"Title: {post.get('title', '')[:100]}"
        )
    
    posts_summary = '\n'.join(summary_parts)
    
    prompt = f"""Based on these student posts about {hw_id}, provide a 2-3 sentence insight summary about:
1. Which problems or topics seemed easiest/hardest
2. Common themes or approaches students took
3. Overall trends in model performance

Posts summary:
{posts_summary}

Total posts analyzed: {len(posts)}

Provide a concise, informative summary (2-3 sentences max):"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful teaching assistant analyzing student homework feedback."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=150,
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating insight for {hw_id}: {e}")
        return f"Analysis of {len(posts)} student submissions using various LLMs."


def generate_model_insight(client: Any, model: str, posts: List[Dict[str, Any]]) -> str:
    """Generate insight summary for a specific model using LLM."""
    # Prepare summary of posts - analyze ALL posts
    summary_parts = []
    for post in posts:
        metrics = post.get('metrics', {})
        summary_parts.append(
            f"- HW: {metrics.get('homework_id')}, "
            f"Focus: {metrics.get('primary_focus')}, "
            f"Depth: {metrics.get('depth_bucket')}, "
            f"Actionability: {metrics.get('actionability_bucket')}"
        )
    
    posts_summary = '\n'.join(summary_parts)
    
    prompt = f"""Based on these student evaluations of {model}, provide a 2-3 sentence insight summary about:
1. What {model} excels at (conceptual vs. mathematical reasoning, etc.)
2. Common strengths or weaknesses observed
3. Overall student sentiment and usefulness

Posts summary:
{posts_summary}

Total posts analyzed: {len(posts)}

Provide a concise, informative summary (2-3 sentences max):"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful teaching assistant analyzing LLM model performance on homework."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=150,
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Error generating insight for {model}: {e}")
        return f"Analysis of {len(posts)} student evaluations of this model."


def generate_insights(posts_path: Path, output_path: Path, api_key: str = None) -> bool:
    """Generate insights and save to JSON file."""
    if OpenAI is None:
        print("Error: OpenAI package not installed. Skipping insights generation.")
        return False
    
    # Get API key from environment or parameter
    if api_key is None:
        api_key = os.getenv('OPENAI_API_KEY')
    
    if not api_key:
        print("Warning: OPENAI_API_KEY not found. Skipping insights generation.")
        print("Set OPENAI_API_KEY in your environment or .env file to enable AI insights.")
        return False
    
    print("Generating AI-powered insights...")
    
    try:
        client = OpenAI(api_key=api_key)
    except Exception as e:
        print(f"Error initializing OpenAI client: {e}")
        return False
    
    # Load posts
    posts = load_processed_posts(posts_path)
    print(f"Loaded {len(posts)} posts")
    
    # Group by homework and model
    hw_groups = group_posts_by_homework(posts)
    model_groups = group_posts_by_model(posts)
    
    insights = {
        'homework': {},
        'models': {},
        'generated_at': None  # Will be set by caller
    }
    
    # Generate homework insights
    print(f"\nGenerating insights for {len(hw_groups)} homework assignments...")
    for hw_id, hw_posts in sorted(hw_groups.items()):
        print(f"  {hw_id}: {len(hw_posts)} posts")
        insight = generate_homework_insight(client, hw_id, hw_posts)
        insights['homework'][hw_id] = {
            'summary': insight,
            'post_count': len(hw_posts)
        }
    
    # Generate model insights
    print(f"\nGenerating insights for {len(model_groups)} models...")
    for model, model_posts in sorted(model_groups.items()):
        print(f"  {model}: {len(model_posts)} posts")
        insight = generate_model_insight(client, model, model_posts)
        insights['models'][model] = {
            'summary': insight,
            'post_count': len(model_posts)
        }
    
    # Save insights
    from datetime import datetime
    insights['generated_at'] = datetime.utcnow().isoformat() + 'Z'
    
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(insights, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Saved insights to {output_path}")
    return True


def main():
    """Main entry point for standalone execution."""
    import sys
    
    # Determine paths
    script_dir = Path(__file__).parent
    site_dir = script_dir.parent
    posts_path = site_dir / 'public' / 'data' / 'posts_processed.json'
    output_path = site_dir / 'public' / 'data' / 'insights.json'
    
    if not posts_path.exists():
        print(f"Error: {posts_path} not found. Run process_data.py first.")
        sys.exit(1)
    
    success = generate_insights(posts_path, output_path)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
