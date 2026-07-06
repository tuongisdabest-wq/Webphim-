/**
 * comments.js — Module bình luận cho KTuongFX
 * Backend: Cloudflare Worker proxy -> GitHub Issues (xem worker.js)
 * Không dùng OAuth thật, chỉ cần tên hiển thị (giống guestbook ẩn danh).
 */
const Comments = {
    // Đổi lại đúng URL worker của bạn nếu khác
    API_BASE: 'https://tmdb-proxy.tuongisdabest.workers.dev/comments',

    // State nội bộ: slug phim đang xem + đang reply cho comment nào (null = không reply)
    currentSlug: null,
    replyingTo: null,

    // Lấy tên đã lưu trước đó (nếu có) để user không phải gõ lại mỗi lần
    getSavedName: () => localStorage.getItem('ktfx_comment_name') || '',
    saveName: (name) => localStorage.setItem('ktfx_comment_name', name),

    // Định dạng thời gian dạng "3 giờ trước" giống ảnh mẫu
    timeAgo: (isoString) => {
        const diffMs = Date.now() - new Date(isoString).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return 'Vừa xong';
        if (mins < 60) return `${mins} phút trước`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} giờ trước`;
        const days = Math.floor(hours / 24);
        return `${days} ngày trước`;
    },

    // Sinh màu avatar ổn định theo tên (để mỗi người có 1 màu riêng, không cần ảnh thật)
    avatarColor: (name) => {
        const colors = ['#fcd34d', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#fb923c'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
        return colors[Math.abs(hash) % colors.length];
    },

    // ================= GỌI API =================

    fetchComments: async (slug) => {
        try {
            const res = await fetch(`${Comments.API_BASE}/${encodeURIComponent(slug)}`);
            if (!res.ok) throw new Error('Lỗi tải bình luận');
            return await res.json();
        } catch (e) {
            console.error(e);
            return [];
        }
    },

    postComment: async (slug, name, message, parentId = null) => {
        const res = await fetch(`${Comments.API_BASE}/${encodeURIComponent(slug)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, message, parentId })
        });
        if (!res.ok) throw new Error('Gửi bình luận thất bại');
        return await res.json();
    },

    react: async (commentId, type) => {
        const res = await fetch(`${Comments.API_BASE}/react`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commentId, type })
        });
        return res.ok ? await res.json() : null;
    },

    // ================= DỰNG CÂY REPLY =================

    // Comment "gốc" là những cái có parentId = null. Reply được gom theo parentId.
    buildTree: (flatList) => {
        const roots = flatList.filter(c => !c.parentId);
        const repliesOf = (id) => flatList.filter(c => c.parentId === id);
        return { roots, repliesOf };
    },

    // ================= RENDER GIAO DIỆN =================

    renderOneComment: (c, repliesOf, isReply = false) => {
        const children = repliesOf(c.id);
        const initial = (c.name || '?').trim().charAt(0).toUpperCase();

        return `
        <div class="${isReply ? 'ml-12 mt-3' : 'mt-5'} pb-4 ${isReply ? '' : 'border-b border-white/5'}">
            <div class="flex gap-3">
                <div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-black shrink-0"
                     style="background:${Comments.avatarColor(c.name)}">${initial}</div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-white text-sm">${c.name}</span>
                        <span class="text-muted text-xs">${Comments.timeAgo(c.createdAt)}</span>
                    </div>
                    <p class="text-gray-300 text-sm mt-1 break-words">${c.text}</p>
                    <div class="flex items-center gap-4 mt-2 text-muted text-xs">
                        <button onclick="Comments.handleReact(${c.id}, 'like')" class="flex items-center gap-1 hover:text-primary">
                            👍 <span id="like-count-${c.id}">${c.likes || ''}</span>
                        </button>
                        <button onclick="Comments.handleReact(${c.id}, 'dislike')" class="flex items-center gap-1 hover:text-red-400">
                            👎 <span id="dislike-count-${c.id}">${c.dislikes || ''}</span>
                        </button>
                        <button onclick="Comments.showReplyBox(${c.id}, '${c.name.replace(/'/g, "\\'")}')" class="hover:text-white">Trả lời</button>
                    </div>
                    <!-- Ô nhập reply sẽ được chèn động vào đây khi bấm "Trả lời" -->
                    <div id="reply-box-${c.id}"></div>
                </div>
            </div>
            ${children.length > 0 ? `
                <button onclick="Comments.toggleReplies(${c.id})" class="ml-12 mt-2 text-primary text-sm font-semibold flex items-center gap-1">
                    <span id="toggle-icon-${c.id}">▾</span> Xem ${children.length} phản hồi
                </button>
                <div id="replies-${c.id}" class="hidden">
                    ${children.map(r => Comments.renderOneComment(r, repliesOf, true)).join('')}
                </div>
            ` : ''}
        </div>`;
    },

    renderAll: (flatList) => {
        const { roots, repliesOf } = Comments.buildTree(flatList);
        if (roots.length === 0) {
            return `<div class="text-center text-muted py-10">Chưa có bình luận nào. Hãy là người đầu tiên!</div>`;
        }
        return roots.map(c => Comments.renderOneComment(c, repliesOf)).join('');
    },

    // Form nhập bình luận gốc (không phải reply), hiển thị cố định trên cùng
    renderForm: () => {
        const savedName = Comments.getSavedName();
        return `
        <div class="bg-surface rounded-2xl p-4 border border-white/5 mb-4">
            <input id="comment-name-input" type="text" placeholder="Tên hiển thị của bạn"
                   value="${savedName}"
                   class="w-full bg-app border border-white/10 rounded-xl px-3 py-2 text-sm text-white mb-2 focus:outline-none focus:border-primary">
            <textarea id="comment-message-input" placeholder="Viết bình luận..." rows="2"
                      class="w-full bg-app border border-white/10 rounded-xl px-3 py-2 text-sm text-white mb-2 focus:outline-none focus:border-primary"></textarea>
            <button onclick="Comments.submit()" class="bg-primary text-black font-bold text-sm px-4 py-2 rounded-xl hover:bg-primary-dark">
                Gửi bình luận
            </button>
        </div>`;
    },

    // ================= HÀNH ĐỘNG NGƯỜI DÙNG =================

    // Gọi khi mở tab "Bình luận" — tải danh sách + render toàn bộ khu vực
    init: async (slug) => {
        Comments.currentSlug = slug;
        const root = document.getElementById('comments-root');
        if (!root) return;
        root.innerHTML = Comments.renderForm() + `<div id="comments-list" class="text-center text-muted py-6">Đang tải bình luận...</div>`;

        const list = await Comments.fetchComments(slug);
        Comments.lastLoadedList = list; // lưu lại để tránh gọi lại API khi chỉ toggle reply
        document.getElementById('comments-list').innerHTML = Comments.renderAll(list);
    },

    // Gửi bình luận gốc (không reply)
    submit: async () => {
        const nameInput = document.getElementById('comment-name-input');
        const msgInput = document.getElementById('comment-message-input');
        const name = nameInput.value.trim();
        const message = msgInput.value.trim();

        if (!name || !message) {
            alert('Vui lòng nhập tên và nội dung bình luận.');
            return;
        }
        Comments.saveName(name); // nhớ tên cho lần sau

        try {
            await Comments.postComment(Comments.currentSlug, name, message, null);
            msgInput.value = '';
            await Comments.init(Comments.currentSlug); // tải lại danh sách mới nhất
        } catch (e) {
            alert('Gửi bình luận thất bại, thử lại sau.');
        }
    },

    // Hiện ô nhập reply ngay dưới comment được bấm "Trả lời"
    showReplyBox: (parentId, parentName) => {
        const box = document.getElementById(`reply-box-${parentId}`);
        if (!box) return;
        // Nếu đang mở sẵn thì đóng lại (bấm 2 lần để hủy)
        if (box.innerHTML) { box.innerHTML = ''; return; }

        const savedName = Comments.getSavedName();
        box.innerHTML = `
            <div class="mt-3 bg-app rounded-xl p-3 border border-white/10">
                <input id="reply-name-${parentId}" type="text" placeholder="Tên của bạn" value="${savedName}"
                       class="w-full bg-surface border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white mb-2">
                <textarea id="reply-msg-${parentId}" placeholder="Trả lời ${parentName}..." rows="2"
                          class="w-full bg-surface border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white mb-2"></textarea>
                <button onclick="Comments.submitReply(${parentId})" class="bg-primary text-black text-xs font-bold px-3 py-1.5 rounded-lg">Gửi</button>
            </div>`;
    },

    submitReply: async (parentId) => {
        const name = document.getElementById(`reply-name-${parentId}`).value.trim();
        const message = document.getElementById(`reply-msg-${parentId}`).value.trim();
        if (!name || !message) { alert('Vui lòng nhập tên và nội dung.'); return; }
        Comments.saveName(name);

        try {
            await Comments.postComment(Comments.currentSlug, name, message, parentId);
            await Comments.init(Comments.currentSlug);
        } catch (e) {
            alert('Gửi phản hồi thất bại, thử lại sau.');
        }
    },

    // Bấm like/dislike: gọi API rồi cập nhật số ngay tại chỗ (không cần tải lại cả danh sách)
    handleReact: async (commentId, type) => {
        const result = await Comments.react(commentId, type);
        if (!result) return;
        const likeEl = document.getElementById(`like-count-${commentId}`);
        const dislikeEl = document.getElementById(`dislike-count-${commentId}`);
        if (likeEl) likeEl.textContent = result.likes || '';
        if (dislikeEl) dislikeEl.textContent = result.dislikes || '';
    },

    // Ẩn/hiện danh sách reply (mũi tên ▾/▸)
    toggleReplies: (id) => {
        const box = document.getElementById(`replies-${id}`);
        const icon = document.getElementById(`toggle-icon-${id}`);
        if (!box) return;
        const isHidden = box.classList.contains('hidden');
        box.classList.toggle('hidden');
        icon.textContent = isHidden ? '▴' : '▾';
    }
};
