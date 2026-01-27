const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

// IndexedDB Setup
let dbPromise;
async function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = idb.openDB('InfiniteOutliner', 1, {
        upgrade(db) {
            // Store for root-level nodes (chunked by top-level node)
            if (!db.objectStoreNames.contains('nodes')) {
                db.createObjectStore('nodes', { keyPath: 'id' });
            }
            // Store for daily notes
            if (!db.objectStoreNames.contains('dailyNotes')) {
                db.createObjectStore('dailyNotes', { keyPath: 'dateKey' });
            }
            // Store for app metadata
            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata');
            }
        }
    });

    return dbPromise;
}

// Helper function to extract tags from text
function extractTags(text) {
    const tagRegex = /#([\w-]+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        tags.push(match[1]);
    }
    return [...new Set(tags)]; // Remove duplicates
}

// Date utility functions for daily notes
function getTodayKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(dateKey) {
    const today = getTodayKey();
    if (dateKey === today) return '📅 Today';

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (dateKey === yesterdayKey) return '📅 Yesterday';

    // Parse the date
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    // Check if it's within the last week
    const daysDiff = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7 && daysDiff > 0) {
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return `📅 ${weekdays[date.getDay()]}`;
    }

    // Format as "Mon, Jan 15, 2024"
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `📅 ${weekdays[date.getDay()]}, ${months[date.getMonth()]} ${day}, ${year}`;
}

// Main App
const App = {
    template: `
        <div id="app">
            <AppHeader
                :current-zoom-path="currentZoomPath"
                :nodes="allNodesWithSpecial"
                :search-query="searchQuery"
                @update-search="searchQuery = $event"
                @navigate-breadcrumb="navigateToBreadcrumb"
                @jump-to-today="jumpToToday"
            />

            <main id="outliner" class="outliner">
                <div v-if="currentNodes.length === 0" class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-text">No notes yet</div>
                    <div class="empty-state-hint">Click below to add your first note</div>
                    <button class="toolbar-btn" style="margin-top: 16px" @click="addRootNode">+ Add Note</button>
                </div>
                <template v-else>
                    <OutlinerNode
                        v-for="node in currentNodes"
                        :key="node.id"
                        :node="node"
                        :all-nodes="nodes"
                        :daily-notes="dailyNotes"
                        :search-query="searchQuery"
                        :all-tags="allTags"
                        :is-transcluded="node.isTranscluded || false"
                        :original-node-id="node.originalNodeId"
                        :dragging-node="draggingNode"
                        @update="handleUpdate"
                        @show-context-menu="showContextMenu"
                        @remove-tag="handleRemoveTag"
                        @drag-start="handleDragStart"
                        @drag-end="handleDragEnd"
                        @drop-node="handleDropNode"
                        @zoom-node="handleZoomNode"
                    />
                </template>
            </main>

            <ContextMenu
                :visible="contextMenuVisible"
                :x="contextMenuX"
                :y="contextMenuY"
                @action="handleContextMenuAction"
            />

            <SelectionToolbar
                :visible="selectionToolbarVisible"
                :x="selectionToolbarX"
                :y="selectionToolbarY"
                @format="formatText"
            />
        </div>
    `,

    setup() {
        // State
        const nodes = ref([]);
        const dailyNotes = ref({}); // Store daily notes by date key
        const currentZoomPath = ref([]);
        const searchQuery = ref('');
        const nextId = ref(1);
        const selectedNode = ref(null);

        // Collapsed state for special nodes
        const tagsCollapsed = ref(false);
        const dailyNotesCollapsed = ref(false);
        const tagNodesCollapsed = ref({}); // Track collapsed state for individual tag nodes

        // Context Menu
        const contextMenuVisible = ref(false);
        const contextMenuX = ref(0);
        const contextMenuY = ref(0);
        const contextMenuNode = ref(null);

        // Selection Toolbar
        const selectionToolbarVisible = ref(false);
        const selectionToolbarX = ref(0);
        const selectionToolbarY = ref(0);

        // Drag and Drop
        const draggingNode = ref(null);

        // Computed
        const allTags = computed(() => {
            const tags = new Set();
            function collectTags(nodeList) {
                for (const node of nodeList) {
                    if (node.tags && node.tags.length > 0) {
                        node.tags.forEach(tag => tags.add(tag));
                    }
                    if (node.children) {
                        collectTags(node.children);
                    }
                }
            }
            collectTags(nodes.value);
            return Array.from(tags).sort();
        });

        const tagsNode = computed(() => {
            const tagNodes = {};

            // Create tag nodes and collect tagged nodes
            allTags.value.forEach(tag => {
                tagNodes[tag] = {
                    id: `tag-${tag}`,
                    text: `#${tag}`,
                    children: [],
                    collapsed: tagNodesCollapsed.value[tag] || false,
                    isTagNode: true,
                    tagName: tag
                };
            });

            // Find all nodes with tags and create transclusions
            function findTaggedNodes(nodeList) {
                for (const node of nodeList) {
                    if (node.tags && node.tags.length > 0) {
                        node.tags.forEach(tag => {
                            if (tagNodes[tag]) {
                                // Create transcluded reference
                                tagNodes[tag].children.push({
                                    ...node,
                                    isTranscluded: true,
                                    originalNodeId: node.id,
                                    id: `transclude-${node.id}-${tag}`,
                                    children: node.children // Keep children for navigation
                                });
                            }
                        });
                    }
                    if (node.children) {
                        findTaggedNodes(node.children);
                    }
                }
            }
            findTaggedNodes(nodes.value);

            return {
                id: 'tags-root',
                text: '🏷️ Tags',
                children: Object.values(tagNodes),
                collapsed: tagsCollapsed.value,
                isTagsRoot: true
            };
        });

        const dailyNotesNode = computed(() => {
            // Get all date keys and sort in reverse chronological order
            const dateKeys = Object.keys(dailyNotes.value).sort().reverse();

            // Create daily note nodes
            const dailyNoteNodes = dateKeys.map(dateKey => {
                return {
                    id: `daily-${dateKey}`,
                    text: formatDateDisplay(dateKey),
                    children: dailyNotes.value[dateKey].children || [],
                    collapsed: dailyNotes.value[dateKey].collapsed || false,
                    isDailyNote: true,
                    dateKey: dateKey
                };
            });

            return {
                id: 'daily-notes-root',
                text: '📅 Daily Notes',
                children: dailyNoteNodes,
                collapsed: dailyNotesCollapsed.value,
                isDailyNotesRoot: true
            };
        });

        const allNodesWithSpecial = computed(() => {
            const specialNodes = [];

            // Add Daily Notes at the top
            specialNodes.push(dailyNotesNode.value);

            // Add Tags if there are any
            if (allTags.value.length > 0) {
                specialNodes.push(tagsNode.value);
            }

            return [...specialNodes, ...nodes.value];
        });

        const currentNodes = computed(() => {
            let result = allNodesWithSpecial.value;
            for (const id of currentZoomPath.value) {
                const node = findNodeById(result, id);
                if (node) {
                    result = node.children;
                }
            }
            return result;
        });

        // Flatten tree for virtual scrolling
        const flattenedNodes = computed(() => {
            const result = [];

            function flatten(nodeList, depth = 0) {
                for (const node of nodeList) {
                    result.push({ node, depth });
                    if (node.children && node.children.length > 0 && !node.collapsed) {
                        flatten(node.children, depth + 1);
                    }
                }
            }

            flatten(currentNodes.value);
            return result;
        });

        // Helper Functions
        function createNode(text = '', children = [], tags = []) {
            return {
                id: nextId.value++,
                text: text,
                children: children,
                collapsed: false,
                tags: tags
            };
        }

        function ensureTodayNote() {
            const todayKey = getTodayKey();
            if (!dailyNotes.value[todayKey]) {
                dailyNotes.value[todayKey] = {
                    children: [],
                    collapsed: false
                };
                saveToStorage();
            }
            return todayKey;
        }

        function jumpToToday() {
            const todayKey = ensureTodayNote();
            const dailyNoteId = `daily-${todayKey}`;

            // Navigate to daily notes root first, then to today
            currentZoomPath.value = ['daily-notes-root', dailyNoteId];
            saveToStorage();

            // Focus on first child or create one if empty
            nextTick(() => {
                const todayNote = dailyNotes.value[todayKey];
                if (todayNote.children.length === 0) {
                    // Add a first node
                    const newNode = createNode('');
                    todayNote.children.push(newNode);
                    saveToStorage();
                    nextTick(() => {
                        const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                        if (nodeEl) nodeEl.focus();
                    });
                } else {
                    // Focus on first node
                    const firstNodeId = todayNote.children[0].id;
                    const nodeEl = document.querySelector(`[data-node-id="${firstNodeId}"] .node-text`);
                    if (nodeEl) nodeEl.focus();
                }
            });
        }

        function findNodeById(nodeList, id, skipTranscluded = false) {
            for (const node of nodeList) {
                if (skipTranscluded && node.isTranscluded) {
                    continue;
                }
                if (node.id === id) return node;
                const found = findNodeById(node.children, id, skipTranscluded);
                if (found) return found;
            }
            return null;
        }

        function findOriginalNode(nodeId) {
            return findNodeById(nodes.value, nodeId, false);
        }

        function findNodeParent(nodeList, targetId, parent = null) {
            for (let i = 0; i < nodeList.length; i++) {
                if (nodeList[i].id === targetId) {
                    return { parent, index: i, siblings: nodeList };
                }
                const found = findNodeParent(nodeList[i].children, targetId, nodeList[i]);
                if (found) return found;
            }
            return null;
        }

        function updateNodeTags(node) {
            if (!node || node.isTranscluded || node.isTagNode || node.isTagsRoot || node.isDailyNote || node.isDailyNotesRoot) {
                return;
            }

            const newTags = extractTags(node.text);

            // Update the node's tags
            const originalNode = findOriginalNode(node.id);
            if (originalNode) {
                originalNode.tags = newTags;
            } else {
                node.tags = newTags;
            }

            // Force Vue reactivity to update transcluded nodes
            nodes.value = [...nodes.value];
        }

        function handleUpdate(updatedNode) {
            // Handle special root nodes
            if (updatedNode.isTagsRoot) {
                tagsCollapsed.value = updatedNode.collapsed;
                saveToStorage();
                return;
            }
            if (updatedNode.isDailyNotesRoot) {
                dailyNotesCollapsed.value = updatedNode.collapsed;
                saveToStorage();
                return;
            }
            // Handle individual tag nodes
            if (updatedNode.isTagNode && updatedNode.tagName) {
                tagNodesCollapsed.value[updatedNode.tagName] = updatedNode.collapsed;
                saveToStorage();
                return;
            }
            // Handle individual daily note nodes
            if (updatedNode.isDailyNote && updatedNode.dateKey && dailyNotes.value[updatedNode.dateKey]) {
                dailyNotes.value[updatedNode.dateKey].collapsed = updatedNode.collapsed;
                saveToStorage();
                return;
            }

            // If it's a transcluded node, find and update the original
            if (updatedNode.isTranscluded && updatedNode.originalNodeId) {
                const originalNode = findOriginalNode(updatedNode.originalNodeId);
                if (originalNode) {
                    // Sync text content and collapsed state from transcluded to original
                    originalNode.text = updatedNode.text;
                    originalNode.collapsed = updatedNode.collapsed;
                    // Update the original node's tags
                    updateNodeTags(originalNode);
                    // Force Vue reactivity by triggering a reference change
                    nodes.value = [...nodes.value];
                }
            } else if (!updatedNode.isTagNode && !updatedNode.isTagsRoot && !updatedNode.isDailyNote && !updatedNode.isDailyNotesRoot) {
                updateNodeTags(updatedNode);
            }

            saveToStorage();
        }

        function handleRemoveTag({ nodeId, tag }) {
            const node = findOriginalNode(nodeId);
            if (node && node.tags) {
                node.tags = node.tags.filter(t => t !== tag);
                // Remove tag from text as well
                node.text = node.text.replace(new RegExp(`#${tag}\\b`, 'g'), '').trim();
                saveToStorage();
            }
        }

        // Drag and Drop Handlers
        function handleDragStart(node) {
            draggingNode.value = node;
        }

        function handleDragEnd() {
            draggingNode.value = null;
        }

        function handleZoomNode(node) {
            const path = getPathToNode(allNodesWithSpecial.value, node.id);
            if (path) {
                currentZoomPath.value = path;
                saveToStorage();
            }
        }

        function handleDropNode({ draggedNode, targetNode, position }) {
            if (!draggedNode || !targetNode || draggedNode.id === targetNode.id) {
                return;
            }

            // Don't allow dropping on special nodes
            if (targetNode.isTagsRoot || targetNode.isTagNode || targetNode.isDailyNotesRoot || targetNode.isDailyNote ||
                draggedNode.isTagsRoot || draggedNode.isTagNode || draggedNode.isDailyNotesRoot || draggedNode.isDailyNote) {
                return;
            }

            // Get original nodes if transcluded
            const sourceNode = draggedNode.isTranscluded ? findOriginalNode(draggedNode.originalNodeId) : draggedNode;
            const destNode = targetNode.isTranscluded ? findOriginalNode(targetNode.originalNodeId) : targetNode;

            if (!sourceNode || !destNode) return;

            // Remove from current location
            const sourceInfo = findNodeParent(nodes.value, sourceNode.id);
            if (!sourceInfo) return;

            // Check if we're trying to drop a node into its own descendant
            function isDescendant(parent, childId) {
                if (parent.id === childId) return true;
                for (const child of parent.children) {
                    if (isDescendant(child, childId)) return true;
                }
                return false;
            }

            if (isDescendant(sourceNode, destNode.id)) {
                return; // Can't drop a node into its own descendant
            }

            sourceInfo.siblings.splice(sourceInfo.index, 1);

            // Add to new location
            if (position === 'inside') {
                destNode.children.push(sourceNode);
                destNode.collapsed = false;
            } else {
                const destInfo = findNodeParent(nodes.value, destNode.id);
                if (destInfo) {
                    const insertIndex = position === 'before' ? destInfo.index : destInfo.index + 1;
                    destInfo.siblings.splice(insertIndex, 0, sourceNode);
                }
            }

            saveToStorage();
        }

        function addRootNode() {
            const newNode = createNode('');
            nodes.value.push(newNode);
            saveToStorage();
            nextTick(() => {
                const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                if (nodeEl) nodeEl.focus();
            });
        }

        function navigateToBreadcrumb(path) {
            currentZoomPath.value = path;
            saveToStorage();
        }

        // Context Menu
        function showContextMenu({ node, event }) {
            event.preventDefault();
            event.stopPropagation();
            contextMenuNode.value = node;
            contextMenuVisible.value = true;

            const x = event.clientX || (event.touches && event.touches[0].clientX);
            const y = event.clientY || (event.touches && event.touches[0].clientY);

            contextMenuX.value = x;
            contextMenuY.value = y;

            nextTick(() => {
                const menu = document.querySelector('.context-menu');
                if (menu) {
                    const rect = menu.getBoundingClientRect();
                    if (rect.right > window.innerWidth) {
                        contextMenuX.value = window.innerWidth - rect.width - 10;
                    }
                    if (rect.bottom > window.innerHeight) {
                        contextMenuY.value = window.innerHeight - rect.height - 10;
                    }
                }
            });
        }

        function handleContextMenuAction(action) {
            if (!contextMenuNode.value) return;

            const node = contextMenuNode.value;

            // If transcluded node, operate on original
            let targetNode = node;
            if (node.isTranscluded && node.originalNodeId) {
                targetNode = findOriginalNode(node.originalNodeId);
            }

            switch (action) {
                case 'addChild':
                    if (!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot) {
                        // For daily note nodes, add child to the daily note data
                        if (node.isDailyNote) {
                            const dateKey = node.dateKey;
                            const newNode = createNode('');
                            dailyNotes.value[dateKey].children.push(newNode);
                            dailyNotes.value[dateKey].collapsed = false;
                            saveToStorage();
                            nextTick(() => {
                                const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                                if (nodeEl) nodeEl.focus();
                            });
                        } else {
                            targetNode.children.push(createNode(''));
                            targetNode.collapsed = false;
                            saveToStorage();
                            nextTick(() => {
                                const nodeEl = document.querySelector(`[data-node-id="${targetNode.children[targetNode.children.length - 1].id}"] .node-text`);
                                if (nodeEl) nodeEl.focus();
                            });
                        }
                    }
                    break;

                case 'addSibling':
                    if (!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote) {
                        const info = findNodeParent(nodes.value, targetNode.id);
                        if (info) {
                            const newNode = createNode('');
                            info.siblings.splice(info.index + 1, 0, newNode);
                            saveToStorage();
                            nextTick(() => {
                                const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                                if (nodeEl) nodeEl.focus();
                            });
                        }
                    }
                    break;

                case 'delete':
                    if (node.isTranscluded && node.originalNodeId) {
                        // If deleting a transcluded node, remove the tag from the original
                        const originalNode = findOriginalNode(node.originalNodeId);
                        const tagName = contextMenuNode.value.tagName ||
                                       (node.id.includes('transclude') ? node.id.split('-').pop() : '');
                        if (originalNode && tagName) {
                            handleRemoveTag({ nodeId: originalNode.id, tag: tagName });
                        }
                    } else if (!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote) {
                        if (confirm('Delete this note and all its children?')) {
                            const deleteInfo = findNodeParent(nodes.value, targetNode.id);
                            if (deleteInfo) {
                                deleteInfo.siblings.splice(deleteInfo.index, 1);
                                saveToStorage();
                            }
                        }
                    }
                    break;

                case 'zoom':
                    const path = getPathToNode(allNodesWithSpecial.value, node.id);
                    if (path) {
                        currentZoomPath.value = path;
                        saveToStorage();
                    }
                    break;
            }

            contextMenuVisible.value = false;
        }

        function getPathToNode(nodeList, targetId, currentPath = []) {
            for (const node of nodeList) {
                if (node.id === targetId) {
                    return [...currentPath, node.id];
                }
                const foundPath = getPathToNode(node.children, targetId, [...currentPath, node.id]);
                if (foundPath) {
                    return foundPath;
                }
            }
            return null;
        }

        // Selection Toolbar
        function handleSelectionChange() {
            const selection = window.getSelection();
            const selectedText = selection.toString();

            if (!selectedText || selection.isCollapsed) {
                selectionToolbarVisible.value = false;
                return;
            }

            const anchorNode = selection.anchorNode;
            let textElement = null;

            if (anchorNode) {
                textElement = anchorNode.nodeType === Node.TEXT_NODE
                    ? anchorNode.parentElement
                    : anchorNode;

                while (textElement && !textElement.classList.contains('node-text')) {
                    textElement = textElement.parentElement;
                    if (!textElement || textElement === document.body) {
                        textElement = null;
                        break;
                    }
                }
            }

            if (!textElement) {
                selectionToolbarVisible.value = false;
                return;
            }

            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            const toolbarHeight = 44;
            const spaceAbove = rect.top;

            let top, left;

            if (spaceAbove > toolbarHeight + 10) {
                top = rect.top + window.scrollY - toolbarHeight - 8;
            } else {
                top = rect.bottom + window.scrollY + 8;
            }

            left = rect.left + window.scrollX + (rect.width / 2);

            selectionToolbarX.value = left;
            selectionToolbarY.value = top;
            selectionToolbarVisible.value = true;
        }

        function formatText(command) {
            document.execCommand(command, false, null);
        }

        // Storage - IndexedDB with debouncing
        let saveTimeout;
        async function saveToStorage() {
            // Debounce saves
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                try {
                    const db = await initDB();
                    const tx = db.transaction(['nodes', 'dailyNotes', 'metadata'], 'readwrite');

                    // Save each root-level node as a chunk
                    const nodesStore = tx.objectStore('nodes');
                    await nodesStore.clear();
                    for (const node of nodes.value) {
                        await nodesStore.put(node);
                    }

                    // Save daily notes
                    const dailyNotesStore = tx.objectStore('dailyNotes');
                    await dailyNotesStore.clear();
                    for (const [dateKey, noteData] of Object.entries(dailyNotes.value)) {
                        await dailyNotesStore.put({ dateKey, ...noteData });
                    }

                    // Save metadata
                    const metadataStore = tx.objectStore('metadata');
                    await metadataStore.put(nextId.value, 'nextId');
                    await metadataStore.put(currentZoomPath.value, 'currentZoomPath');
                    await metadataStore.put(tagsCollapsed.value, 'tagsCollapsed');
                    await metadataStore.put(dailyNotesCollapsed.value, 'dailyNotesCollapsed');
                    await metadataStore.put(tagNodesCollapsed.value, 'tagNodesCollapsed');

                    await tx.done;
                } catch (e) {
                    console.error('Failed to save to IndexedDB:', e);
                }
            }, 300); // Debounce by 300ms
        }

        async function loadFromStorage() {
            try {
                const db = await initDB();

                // Check for localStorage migration
                const localData = localStorage.getItem('infiniteOutliner');
                if (localData) {
                    console.log('Migrating from localStorage to IndexedDB...');
                    const parsed = JSON.parse(localData);
                    nodes.value = parsed.nodes || [];
                    dailyNotes.value = parsed.dailyNotes || {};
                    nextId.value = parsed.nextId || 1;
                    currentZoomPath.value = parsed.currentZoomPath || [];
                    tagsCollapsed.value = parsed.tagsCollapsed || false;
                    dailyNotesCollapsed.value = parsed.dailyNotesCollapsed || false;
                    tagNodesCollapsed.value = parsed.tagNodesCollapsed || {};

                    // Save to IndexedDB and remove localStorage
                    await saveToStorage();
                    localStorage.removeItem('infiniteOutliner');
                    console.log('Migration complete!');
                    return;
                }

                // Load from IndexedDB
                const nodesData = await db.getAll('nodes');
                const dailyNotesData = await db.getAll('dailyNotes');
                const metadata = await db.transaction('metadata').objectStore('metadata');

                nodes.value = nodesData || [];

                // Reconstruct dailyNotes object
                dailyNotes.value = {};
                for (const item of (dailyNotesData || [])) {
                    const { dateKey, ...noteData } = item;
                    dailyNotes.value[dateKey] = noteData;
                }

                nextId.value = (await metadata.get('nextId')) || 1;
                currentZoomPath.value = (await metadata.get('currentZoomPath')) || [];
                tagsCollapsed.value = (await metadata.get('tagsCollapsed')) || false;
                dailyNotesCollapsed.value = (await metadata.get('dailyNotesCollapsed')) || false;
                tagNodesCollapsed.value = (await metadata.get('tagNodesCollapsed')) || {};

                // Ensure all nodes have tags array
                function ensureTags(nodeList) {
                    for (const node of nodeList) {
                        if (!node.tags) {
                            node.tags = extractTags(node.text);
                        }
                        if (node.children) {
                            ensureTags(node.children);
                        }
                    }
                }
                ensureTags(nodes.value);

                // Ensure all daily notes children have tags
                Object.keys(dailyNotes.value).forEach(dateKey => {
                    if (dailyNotes.value[dateKey].children) {
                        ensureTags(dailyNotes.value[dateKey].children);
                    }
                });
            } catch (e) {
                console.error('Failed to load from IndexedDB:', e);
            }
        }

        function initializeDefaultNodes() {
            if (nodes.value.length === 0) {
                nodes.value = [
                    createNode('Welcome to Infinite Outliner! 📝', [
                        createNode('Click the bullet point to add a child note', []),
                        createNode('Press Enter to create a sibling note', []),
                        createNode('Press Tab to indent, Shift+Tab to outdent', []),
                        createNode('Use Arrow Up/Down to navigate between notes', []),
                        createNode('Use Shift+Arrow Up/Down to reorder notes', []),
                        createNode('Use #tags to organize your notes! Try #example', ['example']),
                        createNode('Right-click or long-press for more options', []),
                        createNode('Try the search and zoom features!', [
                            createNode('Zoom in to focus on a specific section', []),
                            createNode('Search to find notes quickly', [])
                        ], [])
                    ], [])
                ];
                saveToStorage();
            }
        }

        // Lifecycle
        onMounted(() => {
            loadFromStorage();
            initializeDefaultNodes();

            document.addEventListener('selectionchange', handleSelectionChange);
            document.addEventListener('click', (e) => {
                const contextMenu = document.querySelector('.context-menu');
                if (contextMenu && !contextMenu.contains(e.target)) {
                    contextMenuVisible.value = false;
                }

                const selectionToolbar = document.querySelector('.selection-toolbar');
                if (selectionToolbar && !selectionToolbar.contains(e.target)) {
                    const target = e.target;
                    let isNodeText = false;
                    let element = target;
                    while (element && element !== document.body) {
                        if (element.classList && element.classList.contains('node-text')) {
                            isNodeText = true;
                            break;
                        }
                        element = element.parentElement;
                    }
                    if (!isNodeText) {
                        selectionToolbarVisible.value = false;
                    }
                }
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    switch(e.key.toLowerCase()) {
                        case 'b':
                            e.preventDefault();
                            formatText('bold');
                            break;
                        case 'i':
                            e.preventDefault();
                            formatText('italic');
                            break;
                        case 'u':
                            e.preventDefault();
                            formatText('underline');
                            break;
                        case 'f':
                            e.preventDefault();
                            const searchInput = document.getElementById('searchInput');
                            if (searchInput) {
                                const panel = document.getElementById('searchPanel');
                                if (panel) panel.classList.remove('hidden');
                                searchInput.focus();
                            }
                            break;
                        case 'd':
                            e.preventDefault();
                            jumpToToday();
                            break;
                    }
                }
            });
        });

        onUnmounted(() => {
            document.removeEventListener('selectionchange', handleSelectionChange);
        });

        return {
            nodes,
            dailyNotes,
            currentZoomPath,
            searchQuery,
            currentNodes,
            flattenedNodes,
            allNodesWithSpecial,
            allTags,
            addRootNode,
            navigateToBreadcrumb,
            contextMenuVisible,
            contextMenuX,
            contextMenuY,
            showContextMenu,
            handleContextMenuAction,
            selectionToolbarVisible,
            selectionToolbarX,
            selectionToolbarY,
            formatText,
            saveToStorage,
            handleUpdate,
            handleRemoveTag,
            draggingNode,
            handleDragStart,
            handleDragEnd,
            handleDropNode,
            handleZoomNode,
            jumpToToday
        };
    }
};

// AppHeader Component
const AppHeader = {
    template: `
        <header class="app-header">
            <div class="header-top">
                <h1>Infinite Outliner</h1>
                <div class="header-buttons">
                    <button @click="$emit('jump-to-today')" class="icon-btn" aria-label="Jump to today" title="Today (Ctrl+D)">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M19,19H5V8H19M16,1V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3H18V1M17,12H12V17H17V12Z"/>
                        </svg>
                    </button>
                    <button @click="toggleSearch" class="icon-btn" aria-label="Toggle search">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <nav class="breadcrumbs">
                <button
                    v-if="currentZoomPath.length === 0"
                    class="breadcrumb active"
                >
                    All Notes
                </button>
                <template v-else>
                    <button class="breadcrumb" @click="$emit('navigate-breadcrumb', [])">
                        All Notes
                    </button>
                    <template v-for="(nodeId, index) in currentZoomPath" :key="nodeId">
                        <span class="breadcrumb-separator">›</span>
                        <button
                            class="breadcrumb"
                            :class="{ active: index === currentZoomPath.length - 1 }"
                            @click="$emit('navigate-breadcrumb', currentZoomPath.slice(0, index + 1))"
                        >
                            {{ getBreadcrumbText(nodeId) }}
                        </button>
                    </template>
                </template>
            </nav>
            <div id="searchPanel" class="search-panel" :class="{ hidden: !searchVisible }">
                <input
                    type="text"
                    id="searchInput"
                    :value="searchQuery"
                    @input="$emit('update-search', $event.target.value.toLowerCase())"
                    placeholder="Search notes..."
                    autocomplete="off"
                >
                <button @click="closeSearch" class="icon-btn small">
                    <svg viewBox="0 0 24 24" width="18" height="18">
                        <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                    </svg>
                </button>
            </div>
        </header>
    `,
    props: ['currentZoomPath', 'nodes', 'searchQuery'],
    emits: ['update-search', 'navigate-breadcrumb', 'jump-to-today'],
    setup(props) {
        const searchVisible = ref(false);

        function toggleSearch() {
            searchVisible.value = !searchVisible.value;
            if (searchVisible.value) {
                nextTick(() => {
                    const input = document.getElementById('searchInput');
                    if (input) input.focus();
                });
            }
        }

        function closeSearch() {
            searchVisible.value = false;
        }

        function findNodeById(nodeList, id) {
            for (const node of nodeList) {
                if (node.id === id) return node;
                const found = findNodeById(node.children, id);
                if (found) return found;
            }
            return null;
        }

        function getBreadcrumbText(nodeId) {
            const node = findNodeById(props.nodes, nodeId);
            if (node) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = node.text;
                const plainText = tempDiv.textContent || tempDiv.innerText || 'Untitled';
                return plainText.substring(0, 30) + (plainText.length > 30 ? '...' : '');
            }
            return 'Untitled';
        }

        return {
            searchVisible,
            toggleSearch,
            closeSearch,
            getBreadcrumbText
        };
    }
};

// OutlinerNode Component (Recursive)
const OutlinerNode = {
    name: 'OutlinerNode',
    template: `
        <div class="node" :class="{
            'transcluded-node': isTranscluded,
            'tag-node': node.isTagNode,
            'tags-root': node.isTagsRoot,
            'daily-note': node.isDailyNote,
            'daily-notes-root': node.isDailyNotesRoot,
            'dragging': isDragging,
            'drag-over': isDragOver
        }" :data-node-id="node.id">
            <div
                v-if="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote && showDropZone === 'before'"
                class="drop-zone drop-zone-before"
                @drop.prevent="handleDrop('before')"
                @dragover.prevent="handleDragOver('before')"
                @dragleave="handleDragLeave"
            ></div>

            <div
                class="node-content"
                :class="{
                    'search-highlight': matchesSearch,
                    'drag-target-inside': showDropZone === 'inside'
                }"
                :draggable="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote && !isTranscluded"
                @dragstart="handleDragStart"
                @dragend="handleDragEnd"
                @dragover.prevent="handleDragOver('inside')"
                @dragleave="handleDragLeave"
                @drop.prevent="handleDrop('inside')"
                @touchstart="handleTouchStart"
                @touchmove="handleTouchMove"
                @touchend="handleTouchEnd"
                @contextmenu="handleContextMenu"
            >
                <button
                    class="expand-btn"
                    :class="{ invisible: node.children.length === 0, collapsed: node.collapsed }"
                    @click="toggleCollapse"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                    </svg>
                </button>

                <div
                    class="node-bullet"
                    :class="{ 'transcluded-bullet': isTranscluded }"
                    @click="handleBulletClick"
                    @touchstart="handleBulletTouchStart"
                    @touchend="handleBulletTouchEnd"
                    @touchmove="handleBulletTouchMove"
                ></div>

                <div
                    v-if="isFocused"
                    class="node-text"
                    :class="{ 'readonly': node.isTagsRoot || node.isTagNode || node.isDailyNotesRoot || node.isDailyNote }"
                    :contenteditable="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote"
                    :data-placeholder="'Type a note...'"
                    @input="handleInput"
                    @keydown="handleKeyDown"
                    @focus="handleFocus"
                    @blur="handleBlur"
                    @keyup="handleKeyUp"
                    ref="textDiv"
                ></div>
                <div
                    v-else
                    class="node-text node-text-display"
                    :class="{ 'readonly': node.isTagsRoot || node.isTagNode || node.isDailyNotesRoot || node.isDailyNote }"
                    :data-placeholder="'Type a note...'"
                    @click="handleTextClick"
                    v-html="formattedText"
                ></div>

                <TagAutocomplete
                    v-if="showAutocomplete && !node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote"
                    :tags="allTags"
                    :filter="autocompleteFilter"
                    :x="autocompleteX"
                    :y="autocompleteY"
                    @select="insertTag"
                    ref="autocomplete"
                />
            </div>

            <div
                v-if="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote && showDropZone === 'after'"
                class="drop-zone drop-zone-after"
                @drop.prevent="handleDrop('after')"
                @dragover.prevent="handleDragOver('after')"
                @dragleave="handleDragLeave"
            ></div>

            <div
                v-if="node.children.length > 0 && !node.collapsed"
                class="node-children"
            >
                <OutlinerNode
                    v-for="child in node.children"
                    :key="child.id"
                    :node="child"
                    :all-nodes="allNodes"
                    :daily-notes="dailyNotes"
                    :search-query="searchQuery"
                    :all-tags="allTags"
                    :is-transcluded="child.isTranscluded || false"
                    :original-node-id="child.originalNodeId"
                    :dragging-node="draggingNode"
                    @update="$emit('update', $event)"
                    @show-context-menu="$emit('show-context-menu', $event)"
                    @remove-tag="$emit('remove-tag', $event)"
                    @drag-start="$emit('drag-start', $event)"
                    @drag-end="$emit('drag-end')"
                    @drop-node="$emit('drop-node', $event)"
                    @zoom-node="$emit('zoom-node', $event)"
                />
            </div>
        </div>
    `,
    props: ['node', 'allNodes', 'dailyNotes', 'searchQuery', 'allTags', 'isTranscluded', 'originalNodeId', 'draggingNode'],
    emits: ['update', 'show-context-menu', 'remove-tag', 'drag-start', 'drag-end', 'drop-node', 'zoom-node'],
    setup(props, { emit }) {
        const textDiv = ref(null);
        const autocomplete = ref(null);
        let longPressTimer = null;
        const isFocused = ref(false);
        const showAutocomplete = ref(false);
        const autocompleteFilter = ref('');
        const autocompleteX = ref(0);
        const autocompleteY = ref(0);
        let autocompletePosition = null;

        // Drag and Drop state
        const isDragging = ref(false);
        const showDropZone = ref(null); // 'before', 'inside', 'after', or null
        const isDragOver = ref(false);
        let touchStartY = 0;
        let touchStartX = 0;
        let touchMoveTimeout = null;
        let dragGhost = null;

        const matchesSearch = computed(() => {
            return props.searchQuery && props.node.text.toLowerCase().includes(props.searchQuery);
        });

        // Parse text to identify tags and create formatted HTML
        const formattedText = computed(() => {
            if (!props.node.text) return '';

            // Replace #tags with clickable chips
            return props.node.text.replace(/#([\w-]+)/g, (match, tag) => {
                return `<span class="tag-chip" data-tag="${tag}">${match}</span>`;
            });
        });

        // Set initial content without v-html binding to avoid cursor issues
        onMounted(() => {
            // Content will be set when focusing, or displayed via formattedText when not focused
        });

        function toggleCollapse() {
            // Toggle the collapsed state on the node
            props.node.collapsed = !props.node.collapsed;
            emit('update', props.node);
        }

        function handleInput(e) {
            props.node.text = e.target.innerHTML;
            emit('update', props.node);
        }

        function handleKeyUp(e) {
            // Check for # trigger for autocomplete
            if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const textNode = range.startContainer;

                    if (textNode.nodeType === Node.TEXT_NODE) {
                        const text = textNode.textContent;
                        const cursorPos = range.startOffset;

                        // Find the last # before cursor
                        const beforeCursor = text.substring(0, cursorPos);
                        const match = beforeCursor.match(/#([\w-]*)$/);

                        if (match && e.key !== 'Escape') {
                            // Show autocomplete
                            autocompleteFilter.value = match[1];
                            autocompletePosition = { range, match };

                            // Position autocomplete
                            const rect = range.getBoundingClientRect();
                            autocompleteX.value = rect.left;
                            autocompleteY.value = rect.bottom + window.scrollY + 4;
                            showAutocomplete.value = true;
                        } else {
                            showAutocomplete.value = false;
                        }
                    }
                }
            }

            // Close on Escape
            if (e.key === 'Escape') {
                showAutocomplete.value = false;
            }
        }

        function insertTag(tag) {
            if (autocompletePosition && textDiv.value) {
                const { range, match } = autocompletePosition;
                const textNode = range.startContainer;

                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorPos = range.startOffset;
                    const beforeCursor = text.substring(0, cursorPos);
                    const afterCursor = text.substring(cursorPos);

                    // Replace the # and partial tag with the complete tag
                    const newBefore = beforeCursor.replace(/#[\w-]*$/, `#${tag}`);
                    textNode.textContent = newBefore + afterCursor;

                    // Set cursor after the tag
                    const newRange = document.createRange();
                    const sel = window.getSelection();
                    newRange.setStart(textNode, newBefore.length);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    // Update node
                    props.node.text = textDiv.value.innerHTML;
                    emit('update', props.node);
                }

                showAutocomplete.value = false;
            }
        }

        function handleFocus(e) {
            if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote) {
                isFocused.value = true;
                e.target.closest('.node-content').classList.add('focused');
                // Populate contenteditable with current text when focusing
                nextTick(() => {
                    if (textDiv.value && props.node.text && textDiv.value.innerHTML !== props.node.text) {
                        textDiv.value.innerHTML = props.node.text;
                    }
                });
            }
        }

        function handleTextClick(e) {
            // Check if a tag chip was clicked
            const tagChip = e.target.closest('.tag-chip');
            if (tagChip) {
                e.stopPropagation();
                const tagName = tagChip.dataset.tag;
                const tagNodeId = `tag-${tagName}`;
                emit('zoom-node', { id: tagNodeId });
            } else {
                // Click on regular text - focus the editor
                isFocused.value = true;
                nextTick(() => {
                    if (textDiv.value) {
                        textDiv.value.focus();
                    }
                });
            }
        }

        function handleBlur(e) {
            isFocused.value = false;
            e.target.closest('.node-content').classList.remove('focused');
            setTimeout(() => {
                showAutocomplete.value = false;
            }, 200);
        }

        function handleContextMenu(e) {
            // Pass the tag name for transcluded nodes
            let contextNode = props.node;
            if (props.isTranscluded) {
                // Extract tag name from parent or ID
                const parentTagNode = e.target.closest('.tag-node');
                if (parentTagNode) {
                    const tagMatch = parentTagNode.textContent.match(/#([\w-]+)/);
                    if (tagMatch) {
                        contextNode = { ...props.node, tagName: tagMatch[1] };
                    }
                }
            }
            emit('show-context-menu', { node: contextNode, event: e });
        }

        function handleBulletTouchStart(e) {
            longPressTimer = setTimeout(() => {
                emit('show-context-menu', { node: props.node, event: e });
            }, 500);
        }

        function handleBulletTouchEnd() {
            clearTimeout(longPressTimer);
        }

        function handleBulletTouchMove() {
            clearTimeout(longPressTimer);
        }

        // Drag and Drop Handlers (Mouse)
        function handleDragStart(e) {
            if (props.node.isTagsRoot || props.node.isTagNode || props.node.isDailyNotesRoot || props.node.isDailyNote || props.isTranscluded) {
                e.preventDefault();
                return;
            }

            isDragging.value = true;
            emit('drag-start', props.node);

            // Create custom drag ghost
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                // Set drag image to a simplified version
                const dragImage = e.target.cloneNode(true);
                dragImage.style.opacity = '0.5';
                dragImage.style.position = 'absolute';
                dragImage.style.top = '-1000px';
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);
                setTimeout(() => document.body.removeChild(dragImage), 0);
            }
        }

        function handleDragEnd(e) {
            isDragging.value = false;
            showDropZone.value = null;
            isDragOver.value = false;
            emit('drag-end');
        }

        function handleDragOver(position) {
            if (!props.draggingNode || props.draggingNode.id === props.node.id) {
                showDropZone.value = null;
                return;
            }

            if (props.node.isTagsRoot || props.node.isTagNode || props.node.isDailyNotesRoot || props.node.isDailyNote) {
                showDropZone.value = null;
                return;
            }

            showDropZone.value = position;
            isDragOver.value = true;
        }

        function handleDragLeave(e) {
            // Only hide if we're actually leaving the node entirely
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
                showDropZone.value = null;
                isDragOver.value = false;
            }
        }

        function handleDrop(position) {
            if (!props.draggingNode || props.draggingNode.id === props.node.id) {
                return;
            }

            emit('drop-node', {
                draggedNode: props.draggingNode,
                targetNode: props.node,
                position: position
            });

            showDropZone.value = null;
            isDragOver.value = false;
        }

        // Touch Drag Handlers (Mobile)
        function handleTouchStart(e) {
            // Don't start drag if touching the text input or bullet
            if (e.target.classList.contains('node-text') ||
                e.target.classList.contains('node-bullet') ||
                e.target.closest('.node-text') ||
                e.target.closest('.node-bullet')) {
                return;
            }

            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            // Start drag after short delay
            touchMoveTimeout = setTimeout(() => {
                if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote && !props.isTranscluded) {
                    isDragging.value = true;
                    emit('drag-start', props.node);

                    // Create visual feedback
                    createTouchDragGhost(e.currentTarget);
                }
            }, 200);
        }

        function handleTouchMove(e) {
            if (touchMoveTimeout) {
                const touch = e.touches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);

                // Cancel if moved too much before timeout
                if (deltaX > 10 || deltaY > 10) {
                    clearTimeout(touchMoveTimeout);
                    touchMoveTimeout = null;
                }
            }

            if (isDragging.value && dragGhost) {
                e.preventDefault();
                const touch = e.touches[0];
                dragGhost.style.left = touch.clientX + 'px';
                dragGhost.style.top = touch.clientY + 'px';

                // Find element under touch
                dragGhost.style.display = 'none';
                const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                dragGhost.style.display = 'block';

                if (elementBelow) {
                    const nodeContent = elementBelow.closest('.node-content');
                    if (nodeContent) {
                        const nodeId = nodeContent.closest('.node').dataset.nodeId;
                        // Trigger visual feedback for drop zone
                        const rect = nodeContent.getBoundingClientRect();
                        const relativeY = touch.clientY - rect.top;
                        const third = rect.height / 3;

                        if (relativeY < third) {
                            handleDragOver('before');
                        } else if (relativeY > third * 2) {
                            handleDragOver('after');
                        } else {
                            handleDragOver('inside');
                        }
                    }
                }
            }
        }

        function handleTouchEnd(e) {
            clearTimeout(touchMoveTimeout);
            touchMoveTimeout = null;

            if (isDragging.value) {
                e.preventDefault();

                // Remove ghost
                if (dragGhost) {
                    document.body.removeChild(dragGhost);
                    dragGhost = null;
                }

                // Find drop target
                const touch = e.changedTouches[0];
                const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);

                if (elementBelow) {
                    const nodeContent = elementBelow.closest('.node-content');
                    if (nodeContent && showDropZone.value) {
                        handleDrop(showDropZone.value);
                    }
                }

                isDragging.value = false;
                showDropZone.value = null;
                emit('drag-end');
            }
        }

        function createTouchDragGhost(element) {
            dragGhost = element.cloneNode(true);
            dragGhost.style.position = 'fixed';
            dragGhost.style.opacity = '0.5';
            dragGhost.style.pointerEvents = 'none';
            dragGhost.style.zIndex = '10000';
            dragGhost.style.width = element.offsetWidth + 'px';
            document.body.appendChild(dragGhost);
        }

        function handleBulletClick(e) {
            e.stopPropagation();
            // Emit zoom-node event
            emit('zoom-node', props.node);
        }

        function addChildNode() {
            if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot) {
                const newNode = {
                    id: Date.now(),
                    text: '',
                    children: [],
                    collapsed: false,
                    tags: []
                };
                props.node.children.push(newNode);
                props.node.collapsed = false;
                emit('update', props.node);

                nextTick(() => {
                    const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                    if (nodeEl) nodeEl.focus();
                });
            }
        }

        function findNodeParent(nodeList, targetId, parent = null) {
            for (let i = 0; i < nodeList.length; i++) {
                if (nodeList[i].id === targetId) {
                    return { parent, index: i, siblings: nodeList };
                }
                const found = findNodeParent(nodeList[i].children, targetId, nodeList[i]);
                if (found) return found;
            }
            return null;
        }

        function getVisibleNodes(nodes = null, result = []) {
            if (nodes === null) {
                nodes = props.allNodes;
            }

            for (const node of nodes) {
                result.push(node.id);
                if (node.children.length > 0 && !node.collapsed) {
                    getVisibleNodes(node.children, result);
                }
            }

            return result;
        }

        function findNodeById(nodeList, id) {
            for (const node of nodeList) {
                if (node.id === id) return node;
                const found = findNodeById(node.children, id);
                if (found) return found;
            }
            return null;
        }

        function focusNode(nodeId) {
            nextTick(() => {
                const nodeEl = document.querySelector(`[data-node-id="${nodeId}"] .node-text`);
                if (nodeEl) {
                    nodeEl.focus();
                    const range = document.createRange();
                    const sel = window.getSelection();
                    range.selectNodeContents(nodeEl);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            });
        }

        function handleKeyDown(e) {
            // Close autocomplete on certain keys
            if (showAutocomplete.value) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    showAutocomplete.value = false;
                    return;
                } else if (e.key === 'Tab' || e.key === 'Enter') {
                    // Let autocomplete handle it
                    if (autocomplete.value && autocomplete.value.handleKeyDown) {
                        if (autocomplete.value.handleKeyDown(e)) {
                            return; // Autocomplete handled it
                        }
                    }
                }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                // Get cursor position
                const selection = window.getSelection();
                if (!selection.rangeCount) return;

                const range = selection.getRangeAt(0);
                const textDiv = e.target;
                const textContent = textDiv.textContent || '';

                // Calculate cursor position in text content
                let cursorPos = 0;
                const treeWalker = document.createTreeWalker(
                    textDiv,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );

                let currentNode;
                let foundCursor = false;
                while (currentNode = treeWalker.nextNode()) {
                    if (currentNode === range.startContainer) {
                        cursorPos += range.startOffset;
                        foundCursor = true;
                        break;
                    } else {
                        cursorPos += currentNode.textContent.length;
                    }
                }

                const info = findNodeParent(props.allNodes, props.node.id);
                if (!info) return;

                // Case 1: Cursor at beginning - insert node above
                if (cursorPos === 0) {
                    const newNode = {
                        id: Date.now(),
                        text: '',
                        children: [],
                        collapsed: false,
                        tags: []
                    };
                    info.siblings.splice(info.index, 0, newNode);
                    emit('update', props.node);
                    focusNode(newNode.id);
                }
                // Case 2: Cursor at end - insert node below
                else if (cursorPos >= textContent.length) {
                    const newNode = {
                        id: Date.now(),
                        text: '',
                        children: [],
                        collapsed: false,
                        tags: []
                    };
                    info.siblings.splice(info.index + 1, 0, newNode);
                    emit('update', props.node);
                    focusNode(newNode.id);
                }
                // Case 3: Cursor in middle - split the node
                else {
                    const beforeCursor = textContent.substring(0, cursorPos);
                    const afterCursor = textContent.substring(cursorPos);

                    // Update current node with text before cursor
                    props.node.text = beforeCursor;
                    textDiv.innerHTML = beforeCursor;

                    // Create new node with text after cursor
                    const newNode = {
                        id: Date.now(),
                        text: afterCursor,
                        children: [],
                        collapsed: false,
                        tags: []
                    };
                    info.siblings.splice(info.index + 1, 0, newNode);
                    emit('update', props.node);
                    focusNode(newNode.id);
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Outdent
                    const info = findNodeParent(props.allNodes, props.node.id);
                    if (info && info.parent) {
                        const grandparentInfo = findNodeParent(props.allNodes, info.parent.id);
                        if (grandparentInfo) {
                            info.siblings.splice(info.index, 1);
                            grandparentInfo.siblings.splice(grandparentInfo.index + 1, 0, props.node);
                            emit('update', props.node);
                            focusNode(props.node.id);
                        }
                    }
                } else {
                    // Indent
                    const info = findNodeParent(props.allNodes, props.node.id);
                    if (info && info.index > 0) {
                        const prevSibling = info.siblings[info.index - 1];
                        info.siblings.splice(info.index, 1);
                        prevSibling.children.push(props.node);
                        prevSibling.collapsed = false;
                        emit('update', props.node);
                        focusNode(props.node.id);
                    }
                }
            } else if (e.key === 'Backspace' && e.target.textContent === '') {
                e.preventDefault();
                // Delete node
                const info = findNodeParent(props.allNodes, props.node.id);
                if (info) {
                    const prevNode = info.siblings[info.index - 1] || info.siblings[info.index + 1];
                    info.siblings.splice(info.index, 1);
                    emit('update', props.node);
                    if (prevNode) {
                        focusNode(prevNode.id);
                    }
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Move up
                    const info = findNodeParent(props.allNodes, props.node.id);
                    if (info && info.index > 0) {
                        const temp = info.siblings[info.index - 1];
                        info.siblings[info.index - 1] = info.siblings[info.index];
                        info.siblings[info.index] = temp;
                        emit('update', props.node);
                        focusNode(props.node.id);
                    }
                } else {
                    // Focus previous
                    const visibleNodes = getVisibleNodes();
                    const currentIndex = visibleNodes.indexOf(props.node.id);
                    if (currentIndex > 0) {
                        focusNode(visibleNodes[currentIndex - 1]);
                    }
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (e.shiftKey) {
                    // Move down
                    const info = findNodeParent(props.allNodes, props.node.id);
                    if (info && info.index < info.siblings.length - 1) {
                        const temp = info.siblings[info.index + 1];
                        info.siblings[info.index + 1] = info.siblings[info.index];
                        info.siblings[info.index] = temp;
                        emit('update', props.node);
                        focusNode(props.node.id);
                    }
                } else {
                    // Focus next
                    const visibleNodes = getVisibleNodes();
                    const currentIndex = visibleNodes.indexOf(props.node.id);
                    if (currentIndex < visibleNodes.length - 1) {
                        focusNode(visibleNodes[currentIndex + 1]);
                    }
                }
            }
        }

        return {
            textDiv,
            autocomplete,
            matchesSearch,
            formattedText,
            isFocused,
            toggleCollapse,
            handleInput,
            handleFocus,
            handleBlur,
            handleTextClick,
            handleContextMenu,
            handleBulletClick,
            handleBulletTouchStart,
            handleBulletTouchEnd,
            handleBulletTouchMove,
            addChildNode,
            handleKeyDown,
            handleKeyUp,
            showAutocomplete,
            autocompleteFilter,
            autocompleteX,
            autocompleteY,
            insertTag,
            isDragging,
            showDropZone,
            isDragOver,
            handleDragStart,
            handleDragEnd,
            handleDragOver,
            handleDragLeave,
            handleDrop,
            handleTouchStart,
            handleTouchMove,
            handleTouchEnd
        };
    }
};

// OutlinerNodeFlat Component (for virtual scrolling)
const OutlinerNodeFlat = {
    name: 'OutlinerNodeFlat',
    template: `
        <div class="node-flat" :class="{
            'transcluded-node': isTranscluded,
            'tag-node': node.isTagNode,
            'tags-root': node.isTagsRoot,
            'daily-note': node.isDailyNote,
            'daily-notes-root': node.isDailyNotesRoot,
            'dragging': isDragging,
            'drag-over': isDragOver
        }" :data-node-id="node.id" :style="{ paddingLeft: (depth * 32) + 'px' }">
            <div
                class="node-content"
                :class="{
                    'search-highlight': matchesSearch,
                    'drag-target-inside': showDropZone === 'inside'
                }"
                :draggable="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote && !isTranscluded"
                @dragstart="handleDragStart"
                @dragend="handleDragEnd"
                @dragover.prevent="handleDragOver('inside')"
                @dragleave="handleDragLeave"
                @drop.prevent="handleDrop('inside')"
                @touchstart="handleTouchStart"
                @touchmove="handleTouchMove"
                @touchend="handleTouchEnd"
                @contextmenu="handleContextMenu"
            >
                <button
                    class="expand-btn"
                    :class="{ invisible: node.children.length === 0, collapsed: node.collapsed }"
                    @click="toggleCollapse"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16">
                        <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                    </svg>
                </button>

                <div
                    class="node-bullet"
                    :class="{ 'transcluded-bullet': isTranscluded }"
                    @click="handleBulletClick"
                    @touchstart="handleBulletTouchStart"
                    @touchend="handleBulletTouchEnd"
                    @touchmove="handleBulletTouchMove"
                ></div>

                <div
                    v-if="isFocused"
                    class="node-text"
                    :class="{ 'readonly': node.isTagsRoot || node.isTagNode || node.isDailyNotesRoot || node.isDailyNote }"
                    :contenteditable="!node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote"
                    :data-placeholder="'Type a note...'"
                    @input="handleInput"
                    @keydown="handleKeyDown"
                    @focus="handleFocus"
                    @blur="handleBlur"
                    @keyup="handleKeyUp"
                    ref="textDiv"
                ></div>
                <div
                    v-else
                    class="node-text node-text-display"
                    :class="{ 'readonly': node.isTagsRoot || node.isTagNode || node.isDailyNotesRoot || node.isDailyNote }"
                    :data-placeholder="'Type a note...'"
                    @click="handleTextClick"
                    v-html="formattedText"
                ></div>

                <TagAutocomplete
                    v-if="showAutocomplete && !node.isTagsRoot && !node.isTagNode && !node.isDailyNotesRoot && !node.isDailyNote"
                    :tags="allTags"
                    :filter="autocompleteFilter"
                    :x="autocompleteX"
                    :y="autocompleteY"
                    @select="insertTag"
                    ref="autocomplete"
                />
            </div>
        </div>
    `,
    props: ['node', 'depth', 'allNodes', 'dailyNotes', 'searchQuery', 'allTags', 'isTranscluded', 'originalNodeId', 'draggingNode'],
    emits: ['update', 'show-context-menu', 'remove-tag', 'drag-start', 'drag-end', 'drop-node', 'zoom-node'],
    setup(props, { emit }) {
        // Reuse the same logic from OutlinerNode
        const textDiv = ref(null);
        const autocomplete = ref(null);
        let longPressTimer = null;
        const isFocused = ref(false);
        const showAutocomplete = ref(false);
        const autocompleteFilter = ref('');
        const autocompleteX = ref(0);
        const autocompleteY = ref(0);
        let autocompletePosition = null;

        // Drag and Drop state
        const isDragging = ref(false);
        const showDropZone = ref(null);
        const isDragOver = ref(false);
        let touchStartY = 0;
        let touchStartX = 0;
        let touchMoveTimeout = null;
        let dragGhost = null;

        const matchesSearch = computed(() => {
            return props.searchQuery && props.node.text.toLowerCase().includes(props.searchQuery);
        });

        const formattedText = computed(() => {
            if (!props.node.text) return '';
            return props.node.text.replace(/#([\w-]+)/g, (match, tag) => {
                return `<span class="tag-chip" data-tag="${tag}">${match}</span>`;
            });
        });

        onMounted(() => {
            // Content will be set when focusing, or displayed via formattedText when not focused
        });

        function toggleCollapse() {
            props.node.collapsed = !props.node.collapsed;
            emit('update', props.node);
        }

        function handleInput(e) {
            props.node.text = e.target.innerHTML;
            emit('update', props.node);
        }

        function handleKeyUp(e) {
            if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote) {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const textNode = range.startContainer;

                    if (textNode.nodeType === Node.TEXT_NODE) {
                        const text = textNode.textContent;
                        const cursorPos = range.startOffset;
                        const beforeCursor = text.substring(0, cursorPos);
                        const match = beforeCursor.match(/#([\w-]*)$/);

                        if (match && e.key !== 'Escape') {
                            autocompleteFilter.value = match[1];
                            autocompletePosition = { range, match };
                            const rect = range.getBoundingClientRect();
                            autocompleteX.value = rect.left;
                            autocompleteY.value = rect.bottom + window.scrollY + 4;
                            showAutocomplete.value = true;
                        } else {
                            showAutocomplete.value = false;
                        }
                    }
                }
            }

            if (e.key === 'Escape') {
                showAutocomplete.value = false;
            }
        }

        function insertTag(tag) {
            if (autocompletePosition && textDiv.value) {
                const { range, match } = autocompletePosition;
                const textNode = range.startContainer;

                if (textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent;
                    const cursorPos = range.startOffset;
                    const beforeCursor = text.substring(0, cursorPos);
                    const afterCursor = text.substring(cursorPos);
                    const newBefore = beforeCursor.replace(/#[\w-]*$/, `#${tag}`);
                    textNode.textContent = newBefore + afterCursor;

                    const newRange = document.createRange();
                    const sel = window.getSelection();
                    newRange.setStart(textNode, newBefore.length);
                    newRange.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(newRange);

                    props.node.text = textDiv.value.innerHTML;
                    emit('update', props.node);
                }

                showAutocomplete.value = false;
            }
        }

        function handleFocus(e) {
            if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote) {
                isFocused.value = true;
                e.target.closest('.node-content').classList.add('focused');
                nextTick(() => {
                    if (textDiv.value && props.node.text && textDiv.value.innerHTML !== props.node.text) {
                        textDiv.value.innerHTML = props.node.text;
                    }
                });
            }
        }

        function handleTextClick(e) {
            const tagChip = e.target.closest('.tag-chip');
            if (tagChip) {
                e.stopPropagation();
                const tagName = tagChip.dataset.tag;
                const tagNodeId = `tag-${tagName}`;
                emit('zoom-node', { id: tagNodeId });
            } else {
                isFocused.value = true;
                nextTick(() => {
                    if (textDiv.value) {
                        textDiv.value.focus();
                    }
                });
            }
        }

        function handleBlur(e) {
            isFocused.value = false;
            e.target.closest('.node-content').classList.remove('focused');
            setTimeout(() => {
                showAutocomplete.value = false;
            }, 200);
        }

        function handleContextMenu(e) {
            let contextNode = props.node;
            if (props.isTranscluded) {
                const parentTagNode = e.target.closest('.tag-node');
                if (parentTagNode) {
                    const tagMatch = parentTagNode.textContent.match(/#([\w-]+)/);
                    if (tagMatch) {
                        contextNode = { ...props.node, tagName: tagMatch[1] };
                    }
                }
            }
            emit('show-context-menu', { node: contextNode, event: e });
        }

        function handleBulletTouchStart(e) {
            longPressTimer = setTimeout(() => {
                emit('show-context-menu', { node: props.node, event: e });
            }, 500);
        }

        function handleBulletTouchEnd() {
            clearTimeout(longPressTimer);
        }

        function handleBulletTouchMove() {
            clearTimeout(longPressTimer);
        }

        function handleDragStart(e) {
            if (props.node.isTagsRoot || props.node.isTagNode || props.node.isDailyNotesRoot || props.node.isDailyNote || props.isTranscluded) {
                e.preventDefault();
                return;
            }

            isDragging.value = true;
            emit('drag-start', props.node);

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                const dragImage = e.target.cloneNode(true);
                dragImage.style.opacity = '0.5';
                dragImage.style.position = 'absolute';
                dragImage.style.top = '-1000px';
                document.body.appendChild(dragImage);
                e.dataTransfer.setDragImage(dragImage, 0, 0);
                setTimeout(() => document.body.removeChild(dragImage), 0);
            }
        }

        function handleDragEnd(e) {
            isDragging.value = false;
            showDropZone.value = null;
            isDragOver.value = false;
            emit('drag-end');
        }

        function handleDragOver(position) {
            if (!props.draggingNode || props.draggingNode.id === props.node.id) {
                showDropZone.value = null;
                return;
            }

            if (props.node.isTagsRoot || props.node.isTagNode || props.node.isDailyNotesRoot || props.node.isDailyNote) {
                showDropZone.value = null;
                return;
            }

            showDropZone.value = position;
            isDragOver.value = true;
        }

        function handleDragLeave(e) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) {
                showDropZone.value = null;
                isDragOver.value = false;
            }
        }

        function handleDrop(position) {
            if (!props.draggingNode || props.draggingNode.id === props.node.id) {
                return;
            }

            emit('drop-node', {
                draggedNode: props.draggingNode,
                targetNode: props.node,
                position: position
            });

            showDropZone.value = null;
            isDragOver.value = false;
        }

        function handleTouchStart(e) {
            if (e.target.classList.contains('node-text') ||
                e.target.classList.contains('node-bullet') ||
                e.target.closest('.node-text') ||
                e.target.closest('.node-bullet')) {
                return;
            }

            const touch = e.touches[0];
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;

            touchMoveTimeout = setTimeout(() => {
                if (!props.node.isTagsRoot && !props.node.isTagNode && !props.node.isDailyNotesRoot && !props.node.isDailyNote && !props.isTranscluded) {
                    isDragging.value = true;
                    emit('drag-start', props.node);
                    createTouchDragGhost(e.currentTarget);
                }
            }, 200);
        }

        function handleTouchMove(e) {
            if (touchMoveTimeout) {
                const touch = e.touches[0];
                const deltaX = Math.abs(touch.clientX - touchStartX);
                const deltaY = Math.abs(touch.clientY - touchStartY);

                if (deltaX > 10 || deltaY > 10) {
                    clearTimeout(touchMoveTimeout);
                    touchMoveTimeout = null;
                }
            }

            if (isDragging.value && dragGhost) {
                e.preventDefault();
                const touch = e.touches[0];
                dragGhost.style.left = touch.clientX + 'px';
                dragGhost.style.top = touch.clientY + 'px';

                dragGhost.style.display = 'none';
                const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
                dragGhost.style.display = 'block';

                if (elementBelow) {
                    const nodeContent = elementBelow.closest('.node-content');
                    if (nodeContent) {
                        const rect = nodeContent.getBoundingClientRect();
                        const relativeY = touch.clientY - rect.top;
                        const third = rect.height / 3;

                        if (relativeY < third) {
                            handleDragOver('before');
                        } else if (relativeY > third * 2) {
                            handleDragOver('after');
                        } else {
                            handleDragOver('inside');
                        }
                    }
                }
            }
        }

        function handleTouchEnd(e) {
            clearTimeout(touchMoveTimeout);
            touchMoveTimeout = null;

            if (isDragging.value) {
                e.preventDefault();

                if (dragGhost) {
                    document.body.removeChild(dragGhost);
                    dragGhost = null;
                }

                const touch = e.changedTouches[0];
                const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);

                if (elementBelow) {
                    const nodeContent = elementBelow.closest('.node-content');
                    if (nodeContent && showDropZone.value) {
                        handleDrop(showDropZone.value);
                    }
                }

                isDragging.value = false;
                showDropZone.value = null;
                emit('drag-end');
            }
        }

        function createTouchDragGhost(element) {
            dragGhost = element.cloneNode(true);
            dragGhost.style.position = 'fixed';
            dragGhost.style.opacity = '0.5';
            dragGhost.style.pointerEvents = 'none';
            dragGhost.style.zIndex = '10000';
            dragGhost.style.width = element.offsetWidth + 'px';
            document.body.appendChild(dragGhost);
        }

        function handleBulletClick(e) {
            e.stopPropagation();
            emit('zoom-node', props.node);
        }

        // Simple keyboard handlers (no navigation - handled at list level)
        function handleKeyDown(e) {
            // Basic handlers only
            if (showAutocomplete.value) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    showAutocomplete.value = false;
                    return;
                }
            }

            if (e.key === 'Backspace' && e.target.textContent === '') {
                e.preventDefault();
                // Delete handled elsewhere
            }
        }

        return {
            textDiv,
            autocomplete,
            matchesSearch,
            formattedText,
            isFocused,
            toggleCollapse,
            handleInput,
            handleFocus,
            handleBlur,
            handleTextClick,
            handleContextMenu,
            handleBulletClick,
            handleBulletTouchStart,
            handleBulletTouchEnd,
            handleBulletTouchMove,
            handleKeyDown,
            handleKeyUp,
            showAutocomplete,
            autocompleteFilter,
            autocompleteX,
            autocompleteY,
            insertTag,
            isDragging,
            showDropZone,
            isDragOver,
            handleDragStart,
            handleDragEnd,
            handleDragOver,
            handleDragLeave,
            handleDrop,
            handleTouchStart,
            handleTouchMove,
            handleTouchEnd
        };
    }
};

// TagAutocomplete Component
const TagAutocomplete = {
    template: `
        <div class="tag-autocomplete" :style="{ left: x + 'px', top: y + 'px' }" v-if="filteredTags.length > 0">
            <div
                v-for="(tag, index) in filteredTags"
                :key="tag"
                class="tag-autocomplete-item"
                :class="{ selected: index === selectedIndex }"
                @mousedown.prevent="$emit('select', tag)"
                @mouseenter="selectedIndex = index"
            >
                #{{ tag }}
            </div>
        </div>
    `,
    props: ['tags', 'filter', 'x', 'y'],
    emits: ['select'],
    setup(props, { emit }) {
        const selectedIndex = ref(0);

        const filteredTags = computed(() => {
            if (!props.filter) {
                return props.tags;
            }
            const filtered = props.tags.filter(tag =>
                tag.toLowerCase().startsWith(props.filter.toLowerCase())
            );

            // Add the current filter as a new tag option if it doesn't exist
            if (props.filter && !props.tags.includes(props.filter)) {
                filtered.push(props.filter);
            }

            return filtered.slice(0, 5); // Limit to 5 suggestions
        });

        watch(() => props.filter, () => {
            selectedIndex.value = 0;
        });

        function handleKeyDown(e) {
            if (filteredTags.value.length === 0) return false;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedIndex.value = (selectedIndex.value + 1) % filteredTags.value.length;
                return true;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedIndex.value = selectedIndex.value === 0
                    ? filteredTags.value.length - 1
                    : selectedIndex.value - 1;
                return true;
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                emit('select', filteredTags.value[selectedIndex.value]);
                return true;
            }

            return false;
        }

        return {
            filteredTags,
            selectedIndex,
            handleKeyDown
        };
    }
};

// ContextMenu Component
const ContextMenu = {
    template: `
        <div
            class="context-menu"
            :class="{ hidden: !visible }"
            :style="{ left: x + 'px', top: y + 'px' }"
        >
            <button class="context-menu-item" @click="$emit('action', 'addChild')">Add Child</button>
            <button class="context-menu-item" @click="$emit('action', 'addSibling')">Add Sibling</button>
            <button class="context-menu-item" @click="$emit('action', 'delete')">Delete</button>
            <button class="context-menu-item" @click="$emit('action', 'zoom')">Zoom In</button>
        </div>
    `,
    props: ['visible', 'x', 'y'],
    emits: ['action']
};

// SelectionToolbar Component
const SelectionToolbar = {
    template: `
        <div
            class="selection-toolbar"
            :class="{ visible: visible }"
            :style="{ left: x + 'px', top: y + 'px', transform: 'translateX(-50%)' }"
        >
            <button
                class="selection-toolbar-btn"
                title="Bold (Ctrl+B)"
                @mousedown.prevent="$emit('format', 'bold')"
            >
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M13.5,15.5H10V12.5H13.5A1.5,1.5 0 0,1 15,14A1.5,1.5 0 0,1 13.5,15.5M10,6.5H13A1.5,1.5 0 0,1 14.5,8A1.5,1.5 0 0,1 13,9.5H10M15.6,10.79C16.57,10.11 17.25,9 17.25,8C17.25,5.74 15.5,4 13.25,4H7V18H14.04C16.14,18 17.75,16.3 17.75,14.21C17.75,12.69 16.89,11.39 15.6,10.79Z"/>
                </svg>
            </button>
            <button
                class="selection-toolbar-btn"
                title="Italic (Ctrl+I)"
                @mousedown.prevent="$emit('format', 'italic')"
            >
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M10,4V7H12.21L8.79,15H6V18H14V15H11.79L15.21,7H18V4H10Z"/>
                </svg>
            </button>
            <button
                class="selection-toolbar-btn"
                title="Underline (Ctrl+U)"
                @mousedown.prevent="$emit('format', 'underline')"
            >
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M5,21H19V19H5V21M12,17A6,6 0 0,0 18,11V3H15.5V11A3.5,3.5 0 0,1 12,14.5A3.5,3.5 0 0,1 8.5,11V3H6V11A6,6 0 0,0 12,17Z"/>
                </svg>
            </button>
            <button
                class="selection-toolbar-btn"
                title="Strikethrough"
                @mousedown.prevent="$emit('format', 'strikeThrough')"
            >
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M23,12V14H1V12H23M7.24,7C7.24,6.09 7.5,5.37 8,4.84C8.5,4.31 9.21,4.04 10.1,4.04C10.65,4.04 11.16,4.13 11.63,4.3C12.1,4.47 12.5,4.7 12.81,5C13.12,5.3 13.36,5.65 13.5,6.04C13.66,6.43 13.74,6.86 13.74,7.3H11.5C11.5,6.76 11.35,6.33 11.06,6C10.77,5.67 10.35,5.5 9.79,5.5C9.32,5.5 8.95,5.64 8.68,5.92C8.41,6.2 8.27,6.58 8.27,7.04C8.27,7.48 8.43,7.86 8.74,8.16L7.24,7M12.63,16.2C12.63,16.76 12.45,17.19 12.08,17.5C11.71,17.81 11.22,17.96 10.6,17.96C10.29,17.96 10,17.91 9.73,17.81C9.46,17.71 9.23,17.57 9.04,17.39C8.85,17.21 8.7,17 8.59,16.75C8.5,16.5 8.43,16.22 8.43,15.9H6.19C6.19,16.38 6.28,16.84 6.46,17.27C6.64,17.7 6.9,18.07 7.24,18.39C7.58,18.71 7.99,18.96 8.46,19.14C8.93,19.32 9.45,19.41 10,19.41C10.57,19.41 11.09,19.34 11.56,19.19C12.03,19.04 12.43,18.84 12.76,18.57C13.09,18.3 13.34,18 13.53,17.64C13.72,17.28 13.81,16.88 13.81,16.45C13.81,16 13.73,15.61 13.57,15.27L12.63,16.2Z"/>
                </svg>
            </button>
        </div>
    `,
    props: ['visible', 'x', 'y'],
    emits: ['format']
};

// Create and mount the app
const app = createApp(App);
app.component('AppHeader', AppHeader);
app.component('OutlinerNode', OutlinerNode);
app.component('OutlinerNodeFlat', OutlinerNodeFlat);
app.component('ContextMenu', ContextMenu);
app.component('SelectionToolbar', SelectionToolbar);
app.component('TagAutocomplete', TagAutocomplete);

// Register RecycleScroller if available
try {
    if (typeof RecycleScroller !== 'undefined') {
        app.component('RecycleScroller', RecycleScroller);
        console.log('RecycleScroller registered successfully');
    } else {
        console.warn('RecycleScroller not available - falling back to non-virtual rendering');
    }
} catch (e) {
    console.error('Error registering RecycleScroller:', e);
}

app.mount('#app');
