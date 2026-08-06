import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://mirrorinkomik.my.id';
const targetGenre = process.env.TARGET_GENRE;

// Ambil username & password dari Environment Variables (GitHub Secrets)
const USERNAME = "rocckyroo";
const PASSWORD = "lgDsFOZtGcDf11Ol";

// Variabel global untuk menyimpan cookie (ci_session)
let globalCookie = ''; 

// Fungsi untuk membuat jeda/delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. HEADER WAJIB: Menyamar sebagai Browser Chrome Asli & menyertakan Referer
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Referer': `${BASE_URL}/`,
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
};

// Header khusus untuk Load More (menggabungkan Default + XHR)
const XHR_HEADERS = {
    ...DEFAULT_HEADERS,
    'X-Requested-With': 'XMLHttpRequest'
};

// ==========================================
// FUNGSI LOGIN UNTUK MENGAMBIL COOKIE
// ==========================================
async function loginSite() {
    if (!USERNAME || !PASSWORD) {
        console.warn("⚠️ Username atau Password tidak diatur. Melanjutkan tanpa login...");
        return;
    }

    console.log("🔐 Memulai proses login untuk mengambil cookie...");
    try {
        // Langkah 1: Kunjungi halaman login untuk ambil CSRF Token & Cookie Awal
        const getResponse = await axios.get(`${BASE_URL}/login`, { headers: DEFAULT_HEADERS });
        
        // Simpan cookie awal (biasanya berisi ci_session kosongan)
        const initialCookies = getResponse.headers['set-cookie'];
        if (initialCookies) {
            globalCookie = initialCookies.map(c => c.split(';')[0]).join('; ');
        }

        const $ = cheerio.load(getResponse.data);
        const csrfToken = $('input[name="csrf_test_name"]').val();

        if (!csrfToken) {
            throw new Error("CSRF token tidak ditemukan di halaman login.");
        }

        // Langkah 2: Kirim data login beserta CSRF token
        const formData = new URLSearchParams();
        formData.append('csrf_test_name', csrfToken);
        formData.append('login', USERNAME);
        formData.append('password', PASSWORD);

        const postResponse = await axios.post(`${BASE_URL}/login`, formData.toString(), {
            headers: {
                ...DEFAULT_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': globalCookie
            },
            // axios secara otomatis mengikuti redirect (302). 
            // Kalau redirect berhasil ke halaman utama, cookie baru akan ada di response.
        });

        // Langkah 3: Perbarui dengan Cookie asli setelah berhasil login
        // Jika web me-redirect saat sukses, cookie mungkin ada di request object (tergantung versi axios).
        // Tapi kita coba ambil dari header set-cookie jika ada.
        const finalCookies = postResponse.headers['set-cookie'] || postResponse.request?.res?.headers['set-cookie'];
        if (finalCookies) {
            globalCookie = finalCookies.map(c => c.split(';')[0]).join('; ');
        }

        console.log("✅ Login berhasil! Cookie (ci_session) sudah tersimpan.");
        await delay(2000); // Jeda bentar biar server gak kaget
    } catch (error) {
        console.error("❌ Gagal login:", error.message);
        // Tergantung kebutuhanmu, bisa exit(1) kalau login wajib, atau lanjut tanpa login.
        process.exit(1); 
    }
}

// ==========================================
// FUNGSI AUTO-RETRY UNTUK MENGATASI ERROR
// ==========================================
async function fetchWithRetry(url, options, maxRetries = 3) {
    // Suntikkan cookie ke dalam headers setiap kali request jika cookie sudah ada
    const finalHeaders = { ...options.headers };
    if (globalCookie) {
        finalHeaders['Cookie'] = globalCookie;
    }

    const finalOptions = { ...options, headers: finalHeaders, timeout: 15000 };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await axios.get(url, finalOptions);
        } catch (error) {
            console.log(`   ⏳ [Peringatan] Request gagal (${error.message}). Percobaan ${attempt}/${maxRetries}...`);
            
            if (attempt === maxRetries) {
                throw error; // Lempar error jika sudah mentok batas maksimal
            }
            
            await delay(3000);
        }
    }
}

async function scrapeGenre(genre) {
    let page = 1;
    let lastId = null;
    let hasNextPage = true;
    const results = [];
    const seenUrls = new Set(); // Mencegah data ganda (duplikat) masuk

    console.log(`\n🚀 Memulai PULL LENGKAP untuk genre: ${genre}...`);

    while (hasNextPage) {
        try {
            let htmlToParse = '';

            if (page === 1) {
                // Pastikan huruf kecil semua sesuai web servernya!
                const safeGenre = genre.toLowerCase().replace(/\s/g, '%20');
                const response = await fetchWithRetry(`${BASE_URL}/genre/${safeGenre}`, {
                    headers: DEFAULT_HEADERS
                });
                htmlToParse = response.data;
                const $ = cheerio.load(htmlToParse);
                lastId = $('#load-more').attr('data-last-id');
                
            } else {
                const response = await fetchWithRetry(`${BASE_URL}/loadmore-type`, {
                    params: { type: genre, last_id: lastId },
                    headers: XHR_HEADERS
                });
                
                if (typeof response.data === 'object') {
                    htmlToParse = response.data.html || '';
                    lastId = response.data.lastId;
                } else {
                    htmlToParse = response.data || '';
                }
            }

            if (lastId === '0' || !lastId) {
                lastId = null;
                hasNextPage = false;
            } else {
                page++;
            }

            const $ = cheerio.load(htmlToParse);
            const cards = $('.bsx a[title], a.komik-card');
            let jumlahSebelumnya = results.length;

            cards.each((i, el) => {
                let url = $(el).attr('href');
                if (url && !url.startsWith('http')) {
                    url = `${BASE_URL}${url}`;
                }

                let title = $(el).attr('title')?.trim() 
                         || $(el).find('.tt').text().trim() 
                         || $(el).find('.komik-info h3').text().trim();
                
                let thumb = $(el).find('img').attr('abs:src') 
                         || $(el).find('img').attr('src');

                if (title && url && !seenUrls.has(url)) {
                    seenUrls.add(url);
                    results.push({ 
                        title, 
                        url, 
                        thumbnail_url: thumb || null 
                    });
                }
            });

            if (results.length === jumlahSebelumnya && htmlToParse.trim() !== '') {
                console.log(`⚠️ Halaman terdeteksi tidak menghasilkan komik baru. Kemungkinan limit server. Menghentikan scrape.`);
                hasNextPage = false;
            } else {
                console.log(`   [${genre}] Berhasil memproses ${results.length} judul (Last ID: ${lastId || 'TAMAT'})`);
            }

            if (hasNextPage) await delay(3000); 

        } catch (error) {
            console.error(`❌ Error pada genre ${genre} (Halaman ${page}):`, error.message);
            hasNextPage = false; 
        }
    }

    await fs.mkdir('genre', { recursive: true });
    
    const fileName = `genre_${genre.toLowerCase().replace(/\s/g, '_')}.json`;
    await fs.writeFile(`genre/${fileName}`, JSON.stringify(results, null, 2));
    console.log(`✅ Selesai! Data genre ${genre} tersimpan di genre/${fileName} (Total: ${results.length} judul)`);
}

// ==========================================
// EKSEKUSI UTAMA (Main Flow)
// ==========================================
async function main() {
    if (!targetGenre) {
        console.error("❌ Target genre tidak ditemukan! Pastikan dijalankan via GitHub Actions dengan parameter genre.");
        process.exit(1);
    }

    // 1. Eksekusi Login Dulu
    await loginSite();

    // 2. Kalau login sukses (atau sengaja dilompati), jalankan Scraper-nya
    await scrapeGenre(targetGenre);
}

// Jalankan program
main();
