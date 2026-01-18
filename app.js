// Infinite Outliner Application
class InfiniteOutliner {
    constructor() {
        this.nodes = [];
        this.currentZoomPath = []; // Path to the currently zoomed node
        this.nextId = 1;
        this.selectedNode = null;
        this.searchQuery = '';
        this.contextMenuNode = null;

        // DOM elements
        this.outlinerEl = document.getElementById('outliner');
        this.breadcrumbsEl = document.getElementById('breadcrumbs');
        this.searchInput = document.getElementById('searchInput');
        this.searchPanel = document.getElementById('searchPanel');
        this.contextMenu = document.getElementById('contextMenu');

        this.init();
    }

    init() {
        // Load data from localStorage
        this.loadFromStorage();

        // If no nodes exist, create initial structure
        if (this.nodes.length === 0) {
            this.nodes = [
                this.createNode('Welcome to Infinite Outliner! 📝', [
                    this.createNode('Click the bullet point to add a child note', []),
                    this.createNode('Press Enter to create a sibling note', []),
                    this.createNode('Press Tab to indent, Shift+Tab to outdent', []),
                    this.createNode('Right-click or long-press for more options', []),
                    this.createNode('Try the search and zoom features!', [
                        this.createNode('Zoom in to focus on a specific section', []),
                        this.createNode('Search to find notes quickly', [])
                    ])
                ])
            ];
            this.saveToStorage();
        }

        this.setupEventListeners();
        this.render();
    }

    createNode(text = '', children = []) {
        return {
            id: this.nextId++,
            text: text,
            children: children,
            collapsed: false
        };
    }

    setupEventListeners() {
        // Search toggle
        document.getElementById('searchToggle').addEventListener('click', () => {
            this.searchPanel.classList.toggle('hidden');
            if (!this.searchPanel.classList.contains('hidden')) {
                this.searchInput.focus();
            } else {
                this.searchQuery = '';
                this.searchInput.value = '';
                this.render();
            }
        });

        // Search close
        document.getElementById('searchClose').addEventListener('click', () => {
            this.searchPanel.classList.add('hidden');
            this.searchQuery = '';
            this.searchInput.value = '';
            this.render();
        });

        // Search input
        this.searchInput.addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.render();
        });

        // Formatting buttons
        document.getElementById('boldBtn').addEventListener('click', () => this.formatText('bold'));
        document.getElementById('italicBtn').addEventListener('click', () => this.formatText('italic'));
        document.getElementById('underlineBtn').addEventListener('click', () => this.formatText('underline'));
        document.getElementById('strikeBtn').addEventListener('click', () => this.formatText('strikeThrough'));

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key.toLowerCase()) {
                    case 'b':
                        e.preventDefault();
                        this.formatText('bold');
                        break;
                    case 'i':
                        e.preventDefault();
                        this.formatText('italic');
                        break;
                    case 'u':
                        e.preventDefault();
                        this.formatText('underline');
                        break;
                    case 'f':
                        e.preventDefault();
                        this.searchPanel.classList.remove('hidden');
                        this.searchInput.focus();
                        break;
                }
            }
        });

        // Close context menu on click outside
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target)) {
                this.contextMenu.classList.add('hidden');
            }
        });

        // Context menu actions
        document.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                if (this.contextMenuNode) {
                    this.handleContextMenuAction(action, this.contextMenuNode);
                }
                this.contextMenu.classList.add('hidden');
            });
        });
    }

    formatText(command) {
        document.execCommand(command, false, null);
    }

    getCurrentNodes() {
        let nodes = this.nodes;
        for (const id of this.currentZoomPath) {
            const node = this.findNodeById(nodes, id);
            if (node) {
                nodes = node.children;
            }
        }
        return nodes;
    }

    findNodeById(nodes, id) {
        for (const node of nodes) {
            if (node.id === id) return node;
            const found = this.findNodeById(node.children, id);
            if (found) return found;
        }
        return null;
    }

    findNodeParent(nodes, targetId, parent = null) {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === targetId) {
                return { parent, index: i, siblings: nodes };
            }
            const found = this.findNodeParent(nodes[i].children, targetId, nodes[i]);
            if (found) return found;
        }
        return null;
    }

    searchInNodes(nodes, query) {
        const results = [];
        for (const node of nodes) {
            if (node.text.toLowerCase().includes(query)) {
                results.push(node);
            }
            results.push(...this.searchInNodes(node.children, query));
        }
        return results;
    }

    render() {
        const currentNodes = this.getCurrentNodes();
        this.outlinerEl.innerHTML = '';

        if (currentNodes.length === 0) {
            this.outlinerEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <div class="empty-state-text">No notes yet</div>
                    <div class="empty-state-hint">Click below to add your first note</div>
                </div>
            `;
            const addBtn = this.createAddButton(() => {
                currentNodes.push(this.createNode(''));
                this.render();
                setTimeout(() => {
                    const inputs = this.outlinerEl.querySelectorAll('.node-text');
                    if (inputs.length > 0) {
                        inputs[inputs.length - 1].focus();
                    }
                }, 0);
            });
            this.outlinerEl.appendChild(addBtn);
        } else {
            currentNodes.forEach(node => {
                this.outlinerEl.appendChild(this.renderNode(node));
            });
        }

        this.renderBreadcrumbs();
        this.saveToStorage();
    }

    renderNode(node, level = 0) {
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'node';
        nodeDiv.dataset.nodeId = node.id;

        const nodeContent = document.createElement('div');
        nodeContent.className = 'node-content';

        // Check if this node matches search
        const matchesSearch = this.searchQuery && node.text.toLowerCase().includes(this.searchQuery);
        if (matchesSearch) {
            nodeContent.classList.add('search-highlight');
        }

        // Expand/collapse button
        const expandBtn = document.createElement('button');
        expandBtn.className = 'expand-btn';
        if (node.children.length === 0) {
            expandBtn.classList.add('invisible');
        }
        if (node.collapsed) {
            expandBtn.classList.add('collapsed');
        }
        expandBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
            </svg>
        `;
        expandBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            node.collapsed = !node.collapsed;
            this.render();
        });

        // Bullet point
        const bullet = document.createElement('div');
        bullet.className = 'node-bullet';
        bullet.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addChildNode(node);
        });

        // Node text (contenteditable)
        const textDiv = document.createElement('div');
        textDiv.className = 'node-text';
        textDiv.contentEditable = true;
        textDiv.innerHTML = node.text || '';
        textDiv.dataset.placeholder = 'Type a note...';

        // Text input handlers
        textDiv.addEventListener('input', () => {
            node.text = textDiv.innerHTML;
            this.saveToStorage();
        });

        textDiv.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.addSiblingNode(node);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.outdentNode(node);
                } else {
                    this.indentNode(node);
                }
            } else if (e.key === 'Backspace' && textDiv.textContent === '') {
                e.preventDefault();
                this.deleteNode(node);
            }
        });

        textDiv.addEventListener('focus', () => {
            this.selectedNode = node;
            nodeContent.classList.add('focused');
        });

        textDiv.addEventListener('blur', () => {
            nodeContent.classList.remove('focused');
        });

        // Context menu (right-click or long-press)
        let longPressTimer;
        const showContextMenu = (e) => {
            e.preventDefault();
            this.contextMenuNode = node;
            this.contextMenu.classList.remove('hidden');

            const x = e.clientX || (e.touches && e.touches[0].clientX);
            const y = e.clientY || (e.touches && e.touches[0].clientY);

            this.contextMenu.style.left = `${x}px`;
            this.contextMenu.style.top = `${y}px`;

            // Adjust if menu goes off-screen
            setTimeout(() => {
                const rect = this.contextMenu.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    this.contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
                }
                if (rect.bottom > window.innerHeight) {
                    this.contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
                }
            }, 0);
        };

        nodeContent.addEventListener('contextmenu', showContextMenu);

        nodeContent.addEventListener('touchstart', (e) => {
            longPressTimer = setTimeout(() => {
                showContextMenu(e);
            }, 500);
        });

        nodeContent.addEventListener('touchend', () => {
            clearTimeout(longPressTimer);
        });

        nodeContent.addEventListener('touchmove', () => {
            clearTimeout(longPressTimer);
        });

        nodeContent.appendChild(expandBtn);
        nodeContent.appendChild(bullet);
        nodeContent.appendChild(textDiv);
        nodeDiv.appendChild(nodeContent);

        // Render children
        if (node.children.length > 0 && !node.collapsed) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'node-children';
            node.children.forEach(child => {
                childrenDiv.appendChild(this.renderNode(child, level + 1));
            });
            nodeDiv.appendChild(childrenDiv);
        }

        return nodeDiv;
    }

    createAddButton(onClick) {
        const btn = document.createElement('button');
        btn.className = 'toolbar-btn';
        btn.style.marginTop = '16px';
        btn.innerHTML = '+ Add Note';
        btn.addEventListener('click', onClick);
        return btn;
    }

    addChildNode(parentNode) {
        const newNode = this.createNode('');
        parentNode.children.push(newNode);
        parentNode.collapsed = false;
        this.render();

        setTimeout(() => {
            const nodeEl = this.outlinerEl.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
            if (nodeEl) nodeEl.focus();
        }, 0);
    }

    addSiblingNode(referenceNode) {
        const info = this.findNodeParent(this.nodes, referenceNode.id);
        if (info) {
            const newNode = this.createNode('');
            info.siblings.splice(info.index + 1, 0, newNode);
            this.render();

            setTimeout(() => {
                const nodeEl = this.outlinerEl.querySelector(`[data-node-id="${newNode.id}"] .node-text`);
                if (nodeEl) nodeEl.focus();
            }, 0);
        }
    }

    indentNode(node) {
        const info = this.findNodeParent(this.nodes, node.id);
        if (info && info.index > 0) {
            const prevSibling = info.siblings[info.index - 1];
            info.siblings.splice(info.index, 1);
            prevSibling.children.push(node);
            prevSibling.collapsed = false;
            this.render();

            setTimeout(() => {
                const nodeEl = this.outlinerEl.querySelector(`[data-node-id="${node.id}"] .node-text`);
                if (nodeEl) nodeEl.focus();
            }, 0);
        }
    }

    outdentNode(node) {
        const info = this.findNodeParent(this.nodes, node.id);
        if (info && info.parent) {
            const grandparentInfo = this.findNodeParent(this.nodes, info.parent.id);
            if (grandparentInfo) {
                info.siblings.splice(info.index, 1);
                grandparentInfo.siblings.splice(grandparentInfo.index + 1, 0, node);
                this.render();

                setTimeout(() => {
                    const nodeEl = this.outlinerEl.querySelector(`[data-node-id="${node.id}"] .node-text`);
                    if (nodeEl) nodeEl.focus();
                }, 0);
            }
        }
    }

    deleteNode(node) {
        const info = this.findNodeParent(this.nodes, node.id);
        if (info) {
            info.siblings.splice(info.index, 1);
            this.render();

            // Focus on previous or next sibling
            setTimeout(() => {
                const prevNode = info.siblings[info.index - 1] || info.siblings[info.index];
                if (prevNode) {
                    const nodeEl = this.outlinerEl.querySelector(`[data-node-id="${prevNode.id}"] .node-text`);
                    if (nodeEl) nodeEl.focus();
                }
            }, 0);
        }
    }

    handleContextMenuAction(action, node) {
        switch (action) {
            case 'addChild':
                this.addChildNode(node);
                break;
            case 'addSibling':
                this.addSiblingNode(node);
                break;
            case 'delete':
                if (confirm('Delete this note and all its children?')) {
                    this.deleteNode(node);
                }
                break;
            case 'zoom':
                this.zoomToNode(node);
                break;
        }
    }

    zoomToNode(node) {
        const path = this.getPathToNode(this.nodes, node.id);
        if (path) {
            this.currentZoomPath = path;
            this.render();
        }
    }

    getPathToNode(nodes, targetId, currentPath = []) {
        for (const node of nodes) {
            if (node.id === targetId) {
                return [...currentPath, node.id];
            }
            const foundPath = this.getPathToNode(node.children, targetId, [...currentPath, node.id]);
            if (foundPath) {
                return foundPath;
            }
        }
        return null;
    }

    renderBreadcrumbs() {
        this.breadcrumbsEl.innerHTML = '';

        if (this.currentZoomPath.length === 0) {
            const crumb = document.createElement('button');
            crumb.className = 'breadcrumb active';
            crumb.textContent = 'All Notes';
            this.breadcrumbsEl.appendChild(crumb);
            return;
        }

        // Root breadcrumb
        const rootCrumb = document.createElement('button');
        rootCrumb.className = 'breadcrumb';
        rootCrumb.textContent = 'All Notes';
        rootCrumb.addEventListener('click', () => {
            this.currentZoomPath = [];
            this.render();
        });
        this.breadcrumbsEl.appendChild(rootCrumb);

        // Path breadcrumbs
        let nodes = this.nodes;
        this.currentZoomPath.forEach((nodeId, index) => {
            const separator = document.createElement('span');
            separator.className = 'breadcrumb-separator';
            separator.textContent = '›';
            this.breadcrumbsEl.appendChild(separator);

            const node = this.findNodeById(nodes, nodeId);
            if (node) {
                const crumb = document.createElement('button');
                crumb.className = 'breadcrumb';
                if (index === this.currentZoomPath.length - 1) {
                    crumb.classList.add('active');
                }

                // Get plain text from HTML content
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = node.text;
                const plainText = tempDiv.textContent || tempDiv.innerText || 'Untitled';
                crumb.textContent = plainText.substring(0, 30) + (plainText.length > 30 ? '...' : '');

                crumb.addEventListener('click', () => {
                    this.currentZoomPath = this.currentZoomPath.slice(0, index + 1);
                    this.render();
                });
                this.breadcrumbsEl.appendChild(crumb);

                nodes = node.children;
            }
        });
    }

    saveToStorage() {
        try {
            const data = {
                nodes: this.nodes,
                nextId: this.nextId,
                currentZoomPath: this.currentZoomPath
            };
            localStorage.setItem('infiniteOutliner', JSON.stringify(data));
        } catch (e) {
            console.error('Failed to save to localStorage:', e);
        }
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem('infiniteOutliner');
            if (data) {
                const parsed = JSON.parse(data);
                this.nodes = parsed.nodes || [];
                this.nextId = parsed.nextId || 1;
                this.currentZoomPath = parsed.currentZoomPath || [];
            }
        } catch (e) {
            console.error('Failed to load from localStorage:', e);
        }
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.outliner = new InfiniteOutliner();
});
