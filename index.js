import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';

const BASE_URL = 'https://mirrorinkomik.my.id';
const targetGenre = process.env.TARGET_GENRE;

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
// FUNGSI AUTO-RETRY UNTUK MENGATASI ERROR
// ==========================================
async function fetchWithRetry(url, options, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Tambahkan timeout 15 detik agar tidak menggantung selamanya (socket hang up)
            const finalOptions = { ...options, timeout: 15000 };
            return await axios.get(url, finalOptions);
        } catch (error) {
            console.log(`   ⏳ [Peringatan] Request gagal (${error.message}). Percobaan ${attempt}/${maxRetries}...`);
            
            if (attempt === maxRetries) {
                throw error; // Lempar error jika sudah mentok batas maksimal
            }
            
            // Jeda 3 detik sebelum mencoba lagi (sesuai permintaanmu)
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
                // Gunakan fetchWithRetry alih-alih axios.get langsung
                const response = await fetchWithRetry(`${BASE_URL}/Genre/${genre}`, {
                    headers: DEFAULT_HEADERS
                });
                htmlToParse = response.data;
                const $ = cheerio.load(htmlToParse);
                lastId = $('#load-more').attr('data-last-id');
                
            } else {
                // Gunakan fetchWithRetry untuk Load More
                const response = await fetchWithRetry(`${BASE_URL}/loadmore-type`, {
                    params: { type: genre, last_id: lastId },
                    headers: XHR_HEADERS
                });
                
                // Pengecekan aman: Memastikan kita memproses JSON jika responsnya objek
                if (typeof response.data === 'object') {
                    htmlToParse = response.data.html || '';
                    lastId = response.data.lastId;
                } else {
                    htmlToParse = response.data || '';
                }
            }

            // Berhenti jika lastId bernilai "0" atau hilang
            if (lastId === '0' || !lastId) {
                lastId = null;
                hasNextPage = false;
            } else {
                page++;
            }

            const $ = cheerio.load(htmlToParse);
            
            // SELECTOR DIPERLUAS (Fallback)
            const cards = $('.bsx a[title], a.komik-card');
            
            let jumlahSebelumnya = results.length;

            cards.each((i, el) => {
                let url = $(el).attr('href');
                if (url && !url.startsWith('http')) {
                    url = `${BASE_URL}${url}`;
                }

                // FALLBACK JUDUL BERTINGKAT
                let title = $(el).attr('title')?.trim() 
                         || $(el).find('.tt').text().trim() 
                         || $(el).find('.komik-info h3').text().trim();
                
                // FALLBACK GAMBAR
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

            // Deteksi pencegah infinite loop jika halaman membalikkan HTML kosong
            if (results.length === jumlahSebelumnya && htmlToParse.trim() !== '') {
                console.log(`⚠️ Halaman terdeteksi tidak menghasilkan komik baru. Kemungkinan limit server. Menghentikan scrape.`);
                hasNextPage = false;
            } else {
                console.log(`   [${genre}] Berhasil memproses ${results.length} judul (Last ID: ${lastId || 'TAMAT'})`);
            }

            // Jeda reguler antar halaman
            if (hasNextPage) await delay(3000); 

        } catch (error) {
            console.error(`❌ Error pada genre ${genre} (Halaman ${page}):`, error.message);
            hasNextPage = false; 
        }
    }

    // Pastikan folder genre dibuat sebelum menulis file
    await fs.mkdir('genre', { recursive: true });
    
    const fileName = `genre_${genre.toLowerCase().replace(/\s/g, '_')}.json`;
    await fs.writeFile(`genre/${fileName}`, JSON.stringify(results, null, 2));
    console.log(`✅ Selesai! Data genre ${genre} tersimpan di genre/${fileName} (Total: ${results.length} judul)`);
}

// Eksekusi utama yang dipanggil oleh GitHub Actions
if (!targetGenre) {
    console.error("❌ Target genre tidak ditemukan! Pastikan dijalankan via GitHub Actions dengan parameter genre.");
    process.exit(1);
} else {
    scrapeGenre(targetGenre);
}
