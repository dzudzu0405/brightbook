# BrightBook Product Requirements

## Product Positioning

BrightBook is a product-kit creator for sellers who want to publish kids activity books on KDP, Etsy, Gumroad, and similar marketplaces.

The product should feel simple for beginners:

1. Enter a book idea.
2. Choose an activity type.
3. BrightBook detects the best theme.
4. Generate a complete product kit.
5. Use the output to create book interiors, image prompts, cover direction, listing assets, and launch materials.

BrightBook should not feel like a complex SaaS dashboard. It should feel like a guided publishing tool that helps non-technical sellers move from idea to product assets quickly.

## Target User

As a user, I am usually one of these people:

- A beginner KDP seller who wants to create low-content or activity books.
- An Etsy printable seller who wants product ideas and worksheet packs.
- A side-hustle buyer who wants simple book kits without learning prompt engineering.
- A creator who wants repeatable product series ideas, not only one-off prompts.

My biggest needs:

- I do not want to write complicated prompts.
- I want the app to understand my book idea.
- I want the output to stay consistent with my niche.
- I need prompts that reduce AI image mistakes.
- I want answer keys and worksheet content, not just pretty scene descriptions.
- I want clear exports that help me build the final product.

## Core User Flow

### Main Flow

1. User enters `Book Idea`.
2. User selects `Activity Type`.
3. App automatically detects `Theme` from the book idea.
4. User selects age group, language, page count, and genre.
5. User optionally opens advanced direction.
6. User clicks `Generate Product Kit`.
7. App generates a complete kit with pages, prompts, answers, cover direction, listing assets, quality checks, and series ideas.

### Theme Detection Requirement

The user should not manually choose a theme from a dropdown.

The app must detect the closest available theme from `Book Idea`.

Example:

```text
Book Idea: cute farm animal word search book for kids
Detected Theme: Farm Animals
```

If the user idea is vague, the app may use a reasonable default, but it should clearly show the detected theme before generation.

## Supported Activity Types For Main Product

The initial focused product should prioritize these 5 activity types:

1. Word Search Book
2. Coloring Book
3. Maze Book
4. Tracing & Handwriting Book
5. Educational Worksheet Pack

These are the safest and most commercially understandable activity types for KDP/Etsy buyers.

## Activity Requirements

### 1. Word Search Book

User expectation:

I want real word-search puzzle data, not just an image prompt.

Output requirements:

- Each page must include exactly one word-search puzzle.
- Each page should have a unique subtopic or vocabulary set.
- Each puzzle should include 10 age-appropriate words.
- Words must be uppercase and printable.
- Grid should use consistent row length.
- Answer key must include every word with row, column, and direction.
- Image prompt should not ask the image model to render grid letters.

Required output fields per page:

- Title
- Instruction
- Word list
- Grid rows
- Answer key
- Image prompt for worksheet frame or border

Quality rule:

The image generator should create the decorative worksheet frame only. Letter grids should be handled as text/layout data.

### 2. Coloring Book

User expectation:

I want clean black-and-white coloring prompts that do not create text, labels, bad anatomy, or messy scenes.

Output requirements:

- Each page must describe one clear coloring scene.
- The scene must stay strongly tied to the detected theme.
- Prompt must request black-and-white line art.
- Prompt must prohibit text, labels, letters, numbers, watermark, logo, and random signs.
- Prompt should include large colorable areas and simple child-friendly shapes.
- Pages should vary across the kit.

Required output fields per page:

- Title
- Coloring instruction
- Scene content items
- Image prompt
- Creative answer guidance

Quality rule:

Coloring prompts should not ask for titles or visible text inside the image.

### 3. Maze Book

User expectation:

I want maze pages that have a clear start, goal, obstacle concept, and solution path.

Output requirements:

- Each page must have one maze.
- Maze must include a start and goal.
- Maze route must be solvable.
- Answer key must give a clear route.
- Themed decoration must stay outside the maze paths.
- Image prompt must request wide, printable paths.

Required output fields per page:

- Title
- Maze instruction
- Start location
- Goal location
- Obstacles or theme decorations
- Solution route
- Image prompt

Quality rule:

The maze should be visually simple enough for children and should not include decorative clutter inside the path.

### 4. Tracing & Handwriting Book

User expectation:

I want handwriting practice pages with clear words or letters to trace.

Output requirements:

- Each page must define exact words, letters, strokes, or sentences.
- Output must include tracing text as structured data.
- Image prompt should not rely on the AI image model to render accurate letters.
- Layout should include tracing rows and independent writing lines.
- Difficulty should match age group.

Required output fields per page:

- Title
- Instruction
- Trace word/letter list
- Writing space requirements
- Completion guidance
- Image prompt for worksheet layout

Quality rule:

Letters and dotted tracing content should be generated as layout/text data, not baked into AI artwork.

### 5. Educational Worksheet Pack

User expectation:

I want a useful worksheet pack with concrete tasks and answers.

Output requirements:

- Each page must focus on one learning objective.
- Each worksheet must include exact task instructions.
- Tasks may include circling, matching, drawing, categorizing, counting, or simple comprehension.
- Answers must be explicit.
- Image prompt should create a clean worksheet frame with room for tasks.

Required output fields per page:

- Title
- Learning objective
- Task list
- Answer key
- Image prompt

Quality rule:

The worksheet must be usable as an educational page, not just a themed illustration.

## Advanced Inputs

### Book Idea

Available in the base product.

Purpose:

- Lets the user describe the product niche.
- Drives theme detection.
- Helps generate more market-specific titles and prompts.

### Special Direction

Recommended for higher-tier plan.

Examples:

```text
Make the pages cute, simple, cozy, and suitable for ages 4-6.
```

### Exclude / Avoid

Recommended for higher-tier plan.

Examples:

```text
No scary animals, no weapons, no text, no complex background.
```

Purpose:

- Helps reduce image generation mistakes.
- Gives users more control without making the interface complicated.

## Product Kit Output Requirements

Every generated kit should include:

- Book title
- Subtitle
- Description
- Page list
- Page instructions
- Image prompts
- Content items
- Answer keys
- Cover prompt
- Keywords
- KDP title/subtitle/description
- Etsy title/tags
- Quality check
- Fix suggestions
- Series ideas
- Publishing checklist

## Pricing And Package Requirements

BrightBook should support low-to-high one-time packages, not only one flat feature set.

The model should be:

```text
Low-ticket Front-End + OTO upgrades
```

### Plan 1: Starter / Front-End

Goal:

Give users a useful low-ticket product that works immediately.

Suggested access:

- Coloring Book
- Word Search Book
- 25 pages per generation
- Basic theme detection
- Basic product kit
- TXT export
- JSON export
- Limited theme catalog

This plan should feel valuable, but it should not unlock every workflow.

### Plan 2: Activity Expansion OTO

Goal:

Unlock more book formats and more product variety.

Suggested access:

- Maze Book
- Tracing & Handwriting Book
- Educational Worksheet Pack
- More themes
- 30 pages per generation
- Save projects
- More structured answer keys

### Plan 3: Publishing Kit OTO

Goal:

Help users prepare products for marketplace listing.

Suggested access:

- Listing kit
- KDP metadata
- Etsy title and tags
- Backend keywords
- A+ content ideas
- Quality score
- Fix suggestions
- Series ideas
- Launch checklist

### Plan 4: Pro / Agency License

Goal:

Unlock everything for power users and service providers.

Suggested access:

- All activity types
- All themes
- Advanced direction
- Exclude / Avoid input
- Save projects
- Full exports
- Larger generation history
- Agency/commercial usage positioning

## Feature Gate Requirements

The backend must enforce plan permissions.

Important feature keys:

```text
activity.coloring
activity.word-search
activity.maze
activity.tracing
activity.learning-worksheet
quantity.25
quantity.30
advanced.custom-direction
export.txt
export.json
export.save-project
kit.listing-assets
kit.quality-check
kit.series-builder
kit.launch-checklist
```

The frontend should hide locked features, but the backend must still reject unauthorized generation requests.

## Quality Requirements

### Prompt Quality

Generated prompts should:

- Stay aligned with detected theme.
- Avoid random text in AI images.
- Avoid copyrighted characters and brands.
- Include enough visual detail for good image generation.
- Avoid overcomplicated scenes for younger children.
- Be different across pages.

### Activity Quality

Generated pages should:

- Match the selected activity type.
- Include complete content items.
- Include exact answer keys when needed.
- Avoid vague answers like "answers may vary" except for creative coloring pages.
- Avoid asking image models to render exact text, letters, or puzzle grids.

### Marketplace Quality

Generated kits should:

- Produce product titles that sound sellable.
- Include marketplace keywords.
- Suggest a series angle.
- Include warnings when output is only a draft.
- Remind users to review before publishing.

## Acceptance Criteria

### Book Idea And Theme Detection

- When the user types "cute farm animals", detected theme should become `Farm Animals`.
- When the user types "ocean animal coloring book", detected theme should become `Ocean Animals`.
- Theme dropdown should not be visible to the user.
- Generated pages should use the detected theme.

### Activity Type Output

- Word Search pages include word list, grid rows, and answer key.
- Coloring pages include black-and-white line art prompts with no text.
- Maze pages include start, goal, and route.
- Tracing pages include exact tracing words or letters.
- Educational Worksheet pages include tasks and answers.

### Plan Gating

- A Front-End user should only see and generate activities included in their plan.
- A locked activity should not appear in the activity dropdown.
- Backend should reject unauthorized activity generation even if called directly.

### Generation Mode

- If Ollama is available, BrightBook should use Ollama for higher-quality generation.
- If Ollama generation fails, BrightBook may fall back to fast generation.
- Fast generation must still return structurally valid activity pages.

## Future Improvements

- Add difficulty levels for Word Search: easy, medium, hard.
- Add randomized/reversed word placement for harder word search grids.
- Add PDF interior export.
- Add Canva-ready export.
- Add page preview rendering.
- Add KDP trim size presets.
- Add commercial license display per plan.
- Add better theme detection using a local classifier or LLM.
