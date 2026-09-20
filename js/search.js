// Beadazzle — Global Live Order Search & Access Modal
import { db, collection, doc, getDoc, query, where, orderBy, limit, getDocs } from './firebase-config.js';

export function initOrderSearch() {
    // 1. Inject password modal if not present
    if (!document.getElementById('order-pwd-modal')) {
        const modal = document.createElement('div');
        modal.id = 'order-pwd-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
          <div class="modal-card">
            <div style="font-size:2rem;margin-bottom:0.5rem;">🔒</div>
            <h3 id="modal-target-nick">Private Order</h3>
            <p>This design is password protected. Enter the password or PIN to unlock it.</p>
            <div id="modal-pwd-error" style="color:#ff4d6d;font-size:0.75rem;margin-bottom:0.8rem;display:none;"></div>
            <input type="password" id="modal-pwd-input" class="form-input" placeholder="Enter password / PIN" style="width:100%;text-align:center;letter-spacing:0.15em;font-size:1.1rem;" autocomplete="off">
            <div class="modal-actions">
              <button class="btn" id="modal-pwd-cancel">Cancel</button>
              <button class="btn solid" id="modal-pwd-submit">Unlock</button>
            </div>
          </div>`;
        document.body.appendChild(modal);

        let activeNick = null;
        let correctPassword = null;

        const closeBtn = document.getElementById('modal-pwd-cancel');
        const submitBtn = document.getElementById('modal-pwd-submit');
        const pwdInput = document.getElementById('modal-pwd-input');
        const errLabel = document.getElementById('modal-pwd-error');

        const closeModal = () => {
            modal.classList.remove('open');
            pwdInput.value = '';
            errLabel.style.display = 'none';
            activeNick = null;
            correctPassword = null;
        };

        closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        submitBtn.addEventListener('click', () => {
            const entered = pwdInput.value.trim();
            if (!entered) {
                errLabel.textContent = 'Please enter the password.';
                errLabel.style.display = 'block';
                return;
            }
            if (entered !== correctPassword) {
                errLabel.textContent = 'Incorrect password. Try again.';
                errLabel.style.display = 'block';
                pwdInput.focus();
                return;
            }
            // Unlock successful
            sessionStorage.setItem(`unlocked_${activeNick}`, 'true');
            location.href = `checkout.html?id=${encodeURIComponent(activeNick)}`;
        });

        pwdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitBtn.click();
        });

        window._openPrivateOrderPrompt = (nick, pwd) => {
            activeNick = nick;
            correctPassword = pwd;
            document.getElementById('modal-target-nick').textContent = `Order: ${nick}`;
            modal.classList.add('open');
            setTimeout(() => pwdInput.focus(), 50);
        };
    }

    // 2. Setup live search box inside .site-header
    const headers = document.querySelectorAll('.site-header');
    headers.forEach(header => {
        if (header.querySelector('.nav-search-wrap')) return;

        const navWrap = document.createElement('div');
        navWrap.className = 'nav-search-wrap';
        navWrap.innerHTML = `
          <span class="nav-search-icon">🔍</span>
          <input type="text" class="nav-search-input" placeholder="Find order..." autocomplete="off">
          <div class="nav-search-dropdown"></div>`;

        // Insert before .header-status or after .site-nav
        const status = header.querySelector('.header-status') || header.querySelector('.site-nav');
        if (status) {
            header.insertBefore(navWrap, status.nextSibling);
        } else {
            header.appendChild(navWrap);
        }

        const input = navWrap.querySelector('.nav-search-input');
        const dropdown = navWrap.querySelector('.nav-search-dropdown');

        let debounce = null;
        input.addEventListener('input', () => {
            clearTimeout(debounce);
            const term = input.value.trim().toLowerCase();
            if (!term) {
                dropdown.classList.remove('open');
                dropdown.innerHTML = '';
                return;
            }
            debounce = setTimeout(async () => {
                try {
                    const q = query(
                        collection(db, 'patterns'),
                        where('nickname', '>=', term),
                        where('nickname', '<=', term + '\uf8ff'),
                        limit(8)
                    );
                    const snap = await getDocs(q);
                    if (snap.empty) {
                        dropdown.innerHTML = `<div class="search-empty">No orders matching "${term}"</div>`;
                        dropdown.classList.add('open');
                        return;
                    }
                    dropdown.innerHTML = '';
                    snap.forEach(docSnap => {
                        const data = docSnap.data();
                        const isPriv = data.isPrivate === true;
                        const item = document.createElement('div');
                        item.className = 'search-result-item';
                        item.innerHTML = `
                          <div class="search-result-name">
                            <span>${data.nickname}</span>
                            ${isPriv ? '<span class="search-padlock">🔒</span>' : ''}
                          </div>
                          <span class="search-result-meta">${data.totalBeads || 0} beads</span>`;

                        item.addEventListener('click', (e) => {
                            e.preventDefault();
                            dropdown.classList.remove('open');
                            input.value = '';
                            if (isPriv) {
                                // check if already unlocked this session
                                if (sessionStorage.getItem(`unlocked_${data.nickname}`) === 'true') {
                                    location.href = `checkout.html?id=${encodeURIComponent(data.nickname)}`;
                                } else {
                                    window._openPrivateOrderPrompt(data.nickname, data.password);
                                }
                            } else {
                                location.href = `checkout.html?id=${encodeURIComponent(data.nickname)}`;
                            }
                        });
                        dropdown.appendChild(item);
                    });
                    dropdown.classList.add('open');
                } catch (e) {
                    console.error('Order search error:', e);
                }
            }, 300);
        });

        document.addEventListener('click', (e) => {
            if (!navWrap.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        });
    });
}

// Auto-run if DOM already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrderSearch);
} else {
    initOrderSearch();
}
