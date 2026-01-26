# Infinite Outliner

A mobile-first, responsive note-taking application with infinite nested outlines. Perfect for organizing thoughts, ideas, and notes in a hierarchical structure.

## Features

### Core Functionality
- **Infinite Nesting**: Create unlimited levels of nested notes
- **Expand/Collapse**: Toggle visibility of child notes to focus on what matters
- **Zoom In**: Focus on any node and treat it as the root level
- **Search**: Quickly find notes with real-time search highlighting
- **Breadcrumbs**: Navigate through your zoom history easily

### Text Formatting
- **Bold** (Ctrl/Cmd + B)
- *Italic* (Ctrl/Cmd + I)
- <u>Underline</u> (Ctrl/Cmd + U)
- ~~Strikethrough~~

### Keyboard Shortcuts
- `Enter`: Create a sibling note
- `Tab`: Indent (move note right)
- `Shift + Tab`: Outdent (move note left)
- `Backspace` (on empty note): Delete note
- `Arrow Up/Down`: Navigate between notes
- `Shift + Arrow Up/Down`: Reorder notes (move up/down)
- `Ctrl/Cmd + B`: Bold
- `Ctrl/Cmd + I`: Italic
- `Ctrl/Cmd + U`: Underline
- `Ctrl/Cmd + F`: Open search

### Mobile Features
- Touch-optimized interface
- Long-press for context menu
- Swipe-friendly breadcrumb navigation
- Responsive design that works on all screen sizes

## Usage

### Getting Started
1. Open `index.html` in your browser
2. Start typing in the default note
3. Press `Enter` to create new notes

### Creating Notes
- **Add Child**: Click the bullet point (•) next to any note
- **Add Sibling**: Press `Enter` while editing a note
- **From Context Menu**: Right-click (or long-press on mobile) and select "Add Child" or "Add Sibling"

### Organizing Notes
- **Indent**: Press `Tab` to move a note under the previous sibling
- **Outdent**: Press `Shift + Tab` to move a note up one level
- **Delete**: Press `Backspace` on an empty note, or use the context menu
- **Expand/Collapse**: Click the arrow (▼) to toggle visibility of child notes

### Navigation
- **Zoom In**: Right-click a note and select "Zoom In" to focus on that branch
- **Breadcrumbs**: Click any breadcrumb to navigate back up the hierarchy
- **Search**: Click the search icon or press `Ctrl/Cmd + F` to find notes

### Data Persistence
All notes are automatically saved to your browser's localStorage. Your data persists across sessions and page refreshes.

## Technical Details

### Stack
- Pure HTML/CSS/JavaScript (no framework required)
- No build process needed
- Works offline after initial load
- localStorage for data persistence

### Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- Requires JavaScript and localStorage enabled

### File Structure
```
├── index.html          # Main HTML structure
├── styles.css          # Mobile-first responsive styles
├── app.js             # Core application logic
└── README.md          # This file
```

## Design Philosophy

### Mobile-First
The interface is designed primarily for mobile devices with:
- Touch-friendly tap targets (minimum 44x44px)
- Optimized spacing and padding
- Horizontal scrolling for breadcrumbs on small screens
- Context menu accessible via long-press

### Progressive Enhancement
The design scales up beautifully on larger screens:
- Tablet: Larger fonts and spacing
- Desktop: Centered layout with max-width for comfortable reading
- Hover states for precise interaction

### Accessibility
- Semantic HTML structure
- ARIA labels for icon buttons
- Keyboard navigation support
- Clear focus indicators
- Sufficient color contrast

## Future Enhancements
Potential features for future development:
- Export/import notes (JSON, Markdown, OPML)
- Multiple note collections
- Drag-and-drop reordering
- Note linking
- Tags and categories
- Cloud sync
- Collaborative editing
- Rich media embedding (images, links)
- Note templates
- Dark mode

## License
This project is open source and available for personal and commercial use.

## Contributing
Contributions are welcome! Feel free to submit issues and pull requests.
