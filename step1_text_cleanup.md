# Step 1: Text Cleanup & Candidate Generation

## Task
Parse fragmented book spine text and generate potential title/author pairings.

## LLM Instructions
```
You are processing fragmented text extracted from book spines. Your goal is to identify potential book title and author combinations.

Key Rules:
1. Adjacent text fragments likely belong to the same book
2. Proper names (especially with titles like "DANIEL C. DENNETT") are typically authors
3. Longer descriptive phrases are typically book titles
4. Titles often span multiple lines
5. Authors may appear before or after titles

Input Format: Raw fragmented text (one fragment per line)

Output Format:
For each potential book, output:
- Title: "[reconstructed title]"
- Author: "[reconstructed author]" 
- Confidence: [0.0-1.0 based on how certain you are]
- Fragments Used: [list the original fragments you combined]

Example Processing:
Input:
DANIEL C. DENNETT FROM BACTERIA TO BACH AND BACK
HARDEN
THE GENETIC

Output:
- Title: "From Bacteria to Bach and Back"
- Author: "Daniel C. Dennett"
- Confidence: 0.9
- Fragments Used: ["DANIEL C. DENNETT", "FROM BACTERIA TO BACH AND BACK"]

Generate multiple candidates if uncertain about fragment groupings.
```

## Implementation Notes
- Use AWS Bedrock Claude/GPT model for this step
- Process entire text block at once for context
- Allow multiple interpretations of ambiguous fragments