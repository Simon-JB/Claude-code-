const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

// Main App
const App = {
    template: `
        <div id="app">
            <AppHeader
                :current-zoom-path="currentZoomPath"
                :nodes="nodes"
                :search-query="searchQuery"
                @update-search="searchQuery = $event"
                @navigate-breadcrumb="navigateToBreadcrumb"
            />

            <main id="outliner" class="outliner">
                <div v-if="currentNodes.length === 0" class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-text">No notes yet</div>
                    <div class="empty-state-hint">Click below to add your first note</div>
                    <button class="toolbar-btn" style="margin-top: 16px" @click="addRootNode">+ Add Note</button>
                </div>
                <OutlinerNode
                    v-for="node in currentNodes"
                    :key="node.id"
                    :node="node"
                    :all-nodes="nodes"
                    :search-query="searchQuery"
                    @update="saveToStorage"
                    @show-context-menu="showContextMenu"
                />
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
        const currentZoomPath = ref([]);
        const searchQuery = ref('');
        const nextId = ref(1);
        const selectedNode = ref(null);

        // Context Menu
        const contextMenuVisible = ref(false);
        const contextMenuX = ref(0);
        const contextMenuY = ref(0);
        const contextMenuNode = ref(null);

        // Selection Toolbar
        const selectionToolbarVisible = ref(false);
        const selectionToolbarX = ref(0);
        const selectionToolbarY = ref(0);

        // Computed
        const currentNodes = computed(() => {
            let result = nodes.value;
            for (const id of currentZoomPath.value) {
                const node = findNodeById(result, id);
                if (node) {
                    result = node.children;
                }
            }
            return result;
        });

        // Helper Functions
        function createNode(text = '', children = []) {
            return {
                id: nextId.value++,
                text: text,
                children: children,
                collapsed: false
            };
        }

        function findNodeById(nodeList, id) {
            for (const node of nodeList) {
                if (node.id === id) return node;
                const found = findNodeById(node.children, id);
                if (found) return found;
            }
            return null;
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

        function addRootNode() {
            const newNode = createNode('');
            currentNodes.value.push(newNode);
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

            switch (action) {
                case 'addChild':
                    node.children.push(createNode(''));
                    node.collapsed = false;
                    saveToStorage();
                    nextTick(() => {
                        const nodeEl = document.querySelector(`[data-node-id="${node.children[node.children.length - 1].id}"] .node-text`);
                        if (nodeEl) nodeEl.focus();
                    });
                    break;

                case 'addSibling':
                    const info = findNodeParent(nodes.value, node.id);
                    if (info) {
                        const newNode = createNode('');
                        info.siblings.splice(info.index + 1, 0, newNode);
                        saveToStorage();
                        nextTick(() => {
                            const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                            if (nodeEl) nodeEl.focus();
                        });
                    }
                    break;

                case 'delete':
                    if (confirm('Delete this note and all its children?')) {
                        const deleteInfo = findNodeParent(nodes.value, node.id);
                        if (deleteInfo) {
                            deleteInfo.siblings.splice(deleteInfo.index, 1);
                            saveToStorage();
                        }
                    }
                    break;

                case 'zoom':
                    const path = getPathToNode(nodes.value, node.id);
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

        // Storage
        function saveToStorage() {
            try {
                const data = {
                    nodes: nodes.value,
                    nextId: nextId.value,
                    currentZoomPath: currentZoomPath.value
                };
                localStorage.setItem('infiniteOutliner', JSON.stringify(data));
            } catch (e) {
                console.error('Failed to save to localStorage:', e);
            }
        }

        function loadFromStorage() {
            try {
                const data = localStorage.getItem('infiniteOutliner');
                if (data) {
                    const parsed = JSON.parse(data);
                    nodes.value = parsed.nodes || [];
                    nextId.value = parsed.nextId || 1;
                    currentZoomPath.value = parsed.currentZoomPath || [];
                }
            } catch (e) {
                console.error('Failed to load from localStorage:', e);
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
                        createNode('Right-click or long-press for more options', []),
                        createNode('Try the search and zoom features!', [
                            createNode('Zoom in to focus on a specific section', []),
                            createNode('Search to find notes quickly', [])
                        ])
                    ])
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
                    }
                }
            });
        });

        onUnmounted(() => {
            document.removeEventListener('selectionchange', handleSelectionChange);
        });

        return {
            nodes,
            currentZoomPath,
            searchQuery,
            currentNodes,
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
            saveToStorage
        };
    }
};

// AppHeader Component
const AppHeader = {
    template: `
        <header class="app-header">
            <div class="header-top">
                <h1>Infinite Outliner</h1>
                <button @click="toggleSearch" class="icon-btn" aria-label="Toggle search">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z"/>
                    </svg>
                </button>
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
    emits: ['update-search', 'navigate-breadcrumb'],
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
        <div class="node" :data-node-id="node.id">
            <div
                class="node-content"
                :class="{ 'search-highlight': matchesSearch }"
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
                    @click="addChildNode"
                    @touchstart="handleBulletTouchStart"
                    @touchend="handleBulletTouchEnd"
                    @touchmove="handleBulletTouchMove"
                ></div>

                <div
                    class="node-text"
                    contenteditable="true"
                    :data-placeholder="'Type a note...'"
                    v-html="node.text"
                    @input="handleInput"
                    @keydown="handleKeyDown"
                    @focus="handleFocus"
                    @blur="handleBlur"
                    ref="textDiv"
                ></div>
            </div>

            <div
                v-if="node.children.length > 0 && !node.collapsed"
                class="node-children"
            >
                <OutlinerNode
                    v-for="child in node.children"
                    :key="child.id"
                    :node="child"
                    :all-nodes="allNodes"
                    :search-query="searchQuery"
                    @update="$emit('update')"
                    @show-context-menu="$emit('show-context-menu', $event)"
                />
            </div>
        </div>
    `,
    props: ['node', 'allNodes', 'searchQuery'],
    emits: ['update', 'show-context-menu'],
    setup(props, { emit }) {
        const textDiv = ref(null);
        let longPressTimer = null;
        const isFocused = ref(false);

        const matchesSearch = computed(() => {
            return props.searchQuery && props.node.text.toLowerCase().includes(props.searchQuery);
        });

        function toggleCollapse() {
            props.node.collapsed = !props.node.collapsed;
            emit('update');
        }

        function handleInput(e) {
            props.node.text = e.target.innerHTML;
            emit('update');
        }

        function handleFocus(e) {
            isFocused.value = true;
            e.target.closest('.node-content').classList.add('focused');
        }

        function handleBlur(e) {
            isFocused.value = false;
            e.target.closest('.node-content').classList.remove('focused');
        }

        function handleContextMenu(e) {
            emit('show-context-menu', { node: props.node, event: e });
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

        function addChildNode() {
            const newNode = {
                id: Date.now(),
                text: '',
                children: [],
                collapsed: false
            };
            props.node.children.push(newNode);
            props.node.collapsed = false;
            emit('update');

            nextTick(() => {
                const nodeEl = document.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                if (nodeEl) nodeEl.focus();
            });
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
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // Add sibling
                const info = findNodeParent(props.allNodes, props.node.id);
                if (info) {
                    const newNode = {
                        id: Date.now(),
                        text: '',
                        children: [],
                        collapsed: false
                    };
                    info.siblings.splice(info.index + 1, 0, newNode);
                    emit('update');
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
                            emit('update');
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
                        emit('update');
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
                    emit('update');
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
                        emit('update');
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
                        emit('update');
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
            matchesSearch,
            toggleCollapse,
            handleInput,
            handleFocus,
            handleBlur,
            handleContextMenu,
            handleBulletTouchStart,
            handleBulletTouchEnd,
            handleBulletTouchMove,
            addChildNode,
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

// Create and mount the app when DOM and Vue are ready
if (typeof Vue === 'undefined') {
    console.error('Vue is not loaded. Please check the CDN link.');
} else {
    const app = createApp(App);
    app.component('AppHeader', AppHeader);
    app.component('OutlinerNode', OutlinerNode);
    app.component('ContextMenu', ContextMenu);
    app.component('SelectionToolbar', SelectionToolbar);
    app.mount('#app');
}
