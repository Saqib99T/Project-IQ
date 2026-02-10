"""
Script to add ALL KB articles from PDFs to the database
Extracts every meaningful section from each PDF
"""
import sys
import os
import re

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fitz  # PyMuPDF
from common.conversation_db import add_kb_article

# PDF paths
PDFS = [
    {
        "path": r"C:\Users\hp\.gemini\antigravity\brain\28f51a40-2000-4707-bacd-66f8cace1bda\.tempmediaStorage\761048b508963230.pdf",
        "title": "eOffice User Manual",
        "source_url": "https://www.iiu.edu.pk/wp-content/uploads/2024/12/eoffice-user-manual-19122024.pdf",
        "category": "eOffice"
    },
    {
        "path": r"C:\Users\hp\.gemini\antigravity\brain\28f51a40-2000-4707-bacd-66f8cace1bda\.tempmediaStorage\391ce2de26315d0e.pdf",
        "title": "Handbook of Accounting Guidelines",
        "source_url": "https://fabs.gov.pk/downloads/02-Handbook-Accounting-Guidelines.pdf",
        "category": "Accounting"
    },
    {
        "path": r"C:\Users\hp\.gemini\antigravity\brain\28f51a40-2000-4707-bacd-66f8cace1bda\.tempmediaStorage\8c70f87fd63b3275.pdf",
        "title": "Office Management Course Material",
        "source_url": "https://sist.sathyabama.ac.in/sist_coursematerial/uploads/SBAA1407.pdf",
        "category": "Office Management"
    }
]

# IT Operations Manual (from Scribd)
IT_OPS_ARTICLES = [
    {
        "title": "IT Department Operations Manual - Overview",
        "content": """The IT Department Operations Manual outlines the structure, functions, and responsibilities of an IT department.

Key Areas:
1. Help Desk Support - First line of support for user issues and requests
2. Network Administration - Managing network infrastructure, connectivity, and security
3. System Administration - Server management, backups, and system maintenance
4. Cybersecurity - Protecting systems from threats, implementing security policies

Best Practices:
- Effective communication with users and stakeholders
- Structured troubleshooting methodologies
- Comprehensive documentation
- Professional development and continuous learning""",
        "category": "IT Operations"
    },
    {
        "title": "Help Desk Support Best Practices",
        "content": """Help Desk Support is the first line of IT support for users experiencing technical issues.

Key Responsibilities:
- Receive and log user requests and incidents
- Provide first-level troubleshooting and resolution
- Escalate complex issues to appropriate teams
- Maintain knowledge base of common solutions

Best Practices:
- Active listening to understand user problems
- Clear communication of solutions
- Timely follow-up on pending issues
- Documentation of all interactions""",
        "category": "IT Operations"
    },
    {
        "title": "Network Administration Guidelines",
        "content": """Network Administration involves managing and maintaining the organization's network infrastructure.

Key Areas:
- Network monitoring and performance optimization
- Firewall and security configuration
- IP address management and DNS
- Wireless network management
- VPN and remote access setup

Best Practices:
- Regular network audits and documentation
- Proactive monitoring for issues
- Change management procedures
- Disaster recovery planning""",
        "category": "IT Operations"
    },
    {
        "title": "System Administration Procedures",
        "content": """System Administration covers server management, maintenance, and user account administration.

Key Responsibilities:
- Server installation and configuration
- Operating system updates and patches
- Backup and recovery procedures
- User account and access management
- Performance monitoring and optimization

Best Practices:
- Regular backup verification
- Documented change procedures
- Security hardening standards
- Capacity planning""",
        "category": "IT Operations"
    },
    {
        "title": "Cybersecurity Policies and Procedures",
        "content": """Cybersecurity protects organizational systems and data from threats.

Key Areas:
- Access control and authentication
- Malware protection and prevention
- Security incident response
- Data protection and encryption
- Security awareness training

Best Practices:
- Regular security assessments
- Multi-factor authentication
- Principle of least privilege
- Incident response planning
- Employee security training""",
        "category": "IT Operations"
    }
]

def extract_all_sections(pdf_path, base_title, category):
    """Extract ALL meaningful sections from PDF"""
    articles = []
    try:
        doc = fitz.open(pdf_path)
        print(f"  Processing {len(doc)} pages...")
        
        # Pattern to detect section headers
        section_patterns = [
            r'^(\d+\.[\d\.]*)\s+(.+)$',  # Numbered sections like "1.1 Title"
            r'^(CHAPTER|SECTION|UNIT|PART)\s+[\dIVX]+',  # Chapter/Section headers
            r'^[A-Z][A-Z\s]{10,50}$',  # All caps headers
        ]
        
        current_content = ""
        current_title = base_title
        section_num = 0
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            
            if not text.strip():
                continue
            
            lines = text.strip().split('\n')
            
            for line in lines:
                line = line.strip()
                if not line or len(line) < 5:
                    continue
                
                # Check if this is a section header
                is_header = False
                header_title = None
                
                # Check numbered sections
                match = re.match(r'^(\d+\.[\d\.]*)\s+(.{5,80})$', line)
                if match:
                    is_header = True
                    header_title = f"{match.group(1)} {match.group(2)}"
                
                # Check all caps headers (10-60 chars)
                elif line.isupper() and 10 < len(line) < 60 and ' ' in line:
                    is_header = True
                    header_title = line.title()
                
                # Check chapter/section headers
                elif re.match(r'^(CHAPTER|SECTION|UNIT|PART)\s+[\dIVX]+', line, re.I):
                    is_header = True
                    header_title = line
                
                if is_header and header_title:
                    # Save previous section if it has enough content
                    if current_content and len(current_content) > 150:
                        section_num += 1
                        articles.append({
                            "id": f"{category.lower().replace(' ', '_')}_{section_num}",
                            "title": current_title[:150],
                            "content": current_content[:3000],
                            "category": category
                        })
                    
                    # Start new section
                    current_title = f"{base_title} - {header_title}"
                    current_content = ""
                else:
                    # Add content to current section
                    if len(line) > 20:  # Skip very short lines
                        current_content += line + "\n"
        
        # Save last section
        if current_content and len(current_content) > 150:
            section_num += 1
            articles.append({
                "id": f"{category.lower().replace(' ', '_')}_{section_num}",
                "title": current_title[:150],
                "content": current_content[:3000],
                "category": category
            })
        
        doc.close()
        print(f"  Extracted {len(articles)} sections")
        
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
    
    return articles

def main():
    all_articles = []
    
    # Add IT Operations Manual articles
    for i, article in enumerate(IT_OPS_ARTICLES):
        article["id"] = f"it_ops_{i+1}"
        all_articles.append(article)
    print(f"Added IT Operations Manual: {len(IT_OPS_ARTICLES)} articles")
    
    # Extract from PDFs
    for pdf_info in PDFS:
        if os.path.exists(pdf_info["path"]):
            print(f"\nProcessing: {pdf_info['title']}")
            articles = extract_all_sections(
                pdf_info["path"],
                pdf_info["title"],
                pdf_info["category"]
            )
            all_articles.extend(articles)
        else:
            print(f"PDF not found: {pdf_info['path']}")
    
    print(f"\n{'='*50}")
    print(f"Total articles to add: {len(all_articles)}")
    print(f"{'='*50}\n")
    
    # Add to database
    success_count = 0
    for article in all_articles:
        try:
            result = add_kb_article(
                article_id=article["id"],
                title=article["title"],
                content=article["content"],
                category=article.get("category", "General"),
                keywords=article.get("keywords", [])
            )
            if result:
                success_count += 1
                if success_count % 20 == 0:
                    print(f"  Progress: {success_count} articles added...")
        except Exception as e:
            print(f"  Error adding {article['title'][:40]}: {e}")
    
    print(f"\nDone! Added {success_count}/{len(all_articles)} articles to KB database.")

if __name__ == "__main__":
    main()
