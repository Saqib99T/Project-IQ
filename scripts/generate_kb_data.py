
import json
import random
import os
import sys

# Add parent directory to path to import actions
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common import conversation_db

def generate_long_articles():
    categories = ["hardware", "software", "network", "security", "account"]
    
    articles = []
    
    print(f"Generating 20 long articles...")
    
    for i in range(1, 21):  # Generate 20 articles
        article_id = f"long_kb_{i:03d}"
        category = random.choice(categories)
        title = f"Comprehensive Guide to {category.capitalize()} Troubleshooting - Part {i}"
        
        # Generate 10-15 sections (Requested: 10-20 articles, 250-300 lines, 10-15 sections)
        num_sections = random.randint(10, 15)
        content_parts = []
        
        content_parts.append(f"# {title}")
        content_parts.append(f"This is a comprehensive guide covering various aspects of {category} issues. Please read carefully.")
        
        for s in range(1, num_sections + 1):
            section_title = f"Section {s}: Advanced {category.capitalize()} Topic {s}"
            content_parts.append(f"## {section_title}")
            
            # Generate paragraph content to reach ~250-300 lines total
            # Each section needs ~20 lines
            paragraph = f"This is the detailed content for {section_title}. " * 10
            content_parts.append(paragraph)
            content_parts.append("\n") # formatting
            
            paragraph_2 = f"Further explanation for {section_title} involves checking configurations and logs. " * 8
            content_parts.append(paragraph_2)
            
            # Add a subsection with list
            content_parts.append(f"### Troubleshooting Steps for Topic {s}")
            steps = []
            for step in range(1, 6):
                steps.append(f"{step}. Specific step {step} for solving this {category} issue in section {s}.")
            content_parts.append("\n".join(steps))
            content_parts.append("\n")

        full_content = "\n\n".join(content_parts)
        
        article = {
            "id": article_id,
            "title": title,
            "category": category,
            "keywords": [category, "troubleshooting", "guide", "advanced", f"topic {i}"],
            "question": f"How do I use the comprehensive {category} guide part {i}?",
            "content": full_content,
            "related": []
        }
        
        articles.append(article)
        
        # Save to DB
        try:
            success = conversation_db.add_kb_article(
                article_id=article['id'],
                title=article['title'],
                content=article['content'],
                category=article['category'],
                keywords=article['keywords'],
                question=article['question']
            )
            if success:
                print(f"Saved {article_id} to DB.")
            else:
                print(f"Failed to save {article_id} to DB (returned False).")
        except Exception as e:
            print(f"CRITICAL ERROR saving {article_id} to DB: {e}")
    
    # Also save to JSON as backup/verification
    output_data = {
        "category": "Long Articles",
        "description": "Synthetic long articles for testing section retrieval",
        "articles": articles
    }
    
    output_path = os.path.join("data", "knowledge_base", "long_articles.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=4)
        
    print(f"Generated {len(articles)} long articles at {output_path}")

if __name__ == "__main__":
    generate_long_articles()

