# Changelog

## v1.2.0

**Rekam sebuah halaman web, dapatkan API-nya sebagai permintaan.**

- **Sesi perekaman.** Jenis item baru di bilah samping membuka sebuah halaman web di mini browser bawaan dan menangkap setiap panggilan API yang dilakukannya — REST, GraphQL, gRPC-web, dan WebSocket — secara langsung, dengan daftar putih dan daftar hitam berbasis regex, jeda dan henti dari baris alamat, serta lencana merah “mengudara” selama berjalan. Setiap panggilan yang ditangkap dibaca persis seperti respons sebuah permintaan (isi, informasi, cookie, grafik); menu konteks sebuah panggilan menambahkan url-nya ke salah satu daftar, dengan pilihan untuk memangkas apa yang sudah ditangkap. Tangkapan tetap berada di memori, dibatasi oleh pengaturan aplikasi yang baru, dan tidak pernah menyentuh berkas proyek Anda.
- **Simpulkan rute (Pro).** Satu tombol mengubah tangkapan menjadi pohon folder berisi permintaan sungguhan yang dapat diputar ulang: segmen jalur yang berubah-ubah menjadi parameter jalur `{{param}}`, folder mengikuti prefiks statis, panggilan gRPC-web dikelompokkan per layanan, dan setiap permintaan sudah terisi dari panggilan sukses terakhir, dengan panggilan yang ditangkap di riwayat responsnya. Menyimpulkan lagi akan menggabungkan — perubahan Anda tetap dipertahankan.
- **Kendalikan dari asisten AI Anda.** Sepuluh alat MCP membuat dan mengonfigurasi sesi, memulai dan menghentikan perekaman, membaca tangkapan, dan menyimpulkan rute.
- **Bagikan lokasi Anda dengan mini browser (opsional).** Pengaturan Privasi baru, nonaktif secara bawaan, memungkinkan halaman yang dibuka di browser bawaan — selama perekaman atau tidak — membaca perkiraan lokasi Anda, seperti yang dilakukan fitur lokasi situs itu sendiri di browser biasa. Mengaktifkannya terlebih dahulu meminta persetujuan Anda; lokasi berasal dari layanan lokasi sistem (GeoClue di Linux), atau jika tidak tersedia, dari perkiraan setingkat kota berdasarkan alamat IP Anda. Menonaktifkannya segera melupakan lokasi tersebut.
- **Tab Respons yang lebih kaya.** Gambar kini ditampilkan langsung, video dan audio dapat diputar, Markdown dirender, dan editor kode memilih bahasa dari Content-Type — dengan tombol Unduh yang sudah diterjemahkan dan selalu tersedia. Respons biner yang diputar ulang dari riwayat tidak lagi menampilkan base64-nya.
- **Daftar panjang tetap gesit.** Daftar tangkapan (dan bilah samping di atas 400 baris) hanya merender apa yang tampak di layar.
- Berkas proyek yang berisi sesi perekaman disimpan dalam format 1.2; versi Restorm yang lebih lama meminta Anda memperbarui sebelum membukanya.

## v1.1.4

**Hubungkan asisten AI Anda di macOS — kini andal.**

- **Diperbaiki: Claude Desktop dan Cursor di macOS.** Menghubungkan asisten AI memuat alat-alat Restorm, tetapi kemudian setiap panggilan gagal dengan “tidak ada instansi yang berjalan”, bahkan saat Restorm terbuka — aplikasi dan konektor saling mencari di folder sementara yang berbeda. Kini keduanya bertemu dengan andal, apa pun yang menjalankan konektor.
- **Sapaan formal dalam bahasa Italia, Polandia, dan Finlandia.** Antarmuka kini menyapa Anda dalam register formal dalam ketiga bahasa ini, selaras dengan yang lain.
- **Aksi Code di skenario — lebih rapi, dengan contoh bawaan.** Node Code tidak lagi melebar saat skrip panjang, dan editornya mendapat tab **Butuh bantuan?** yang menampilkan contoh siap jalan dalam bahasa yang Anda pilih (TypeScript, JavaScript, Python, Lua, Ruby, R, C#). Menempel saat editor terbuka tidak lagi menaruh node Code liar di kanvas.
- **Temukan masalah desain pada API impor Anda.** Setelah mengimpor API — atau saat membuka kembali sebuah berkas — Restorm diam-diam memeriksa setiap API untuk masalah struktural (rute duplikat, respons yang hilang, jalur yang berbenturan dengan Mock Server…), menandainya di bilah sisi dengan “!”, dan menambahkan tab “Masalah” yang mencantumkan setiap masalah dan rute yang tepat terpengaruh, dengan setiap rute dapat dibentangkan ke dokumentasinya.

## v1.1.3

**Hubungkan asisten AI Anda ke Restorm.**

- **Dengan satu klik, dari aplikasi.** Menu MCP di bilah status kini menawarkan “Tambahkan Restorm ke asisten AI Anda” — penyiapan siap tempel untuk Claude Code, Claude Desktop, dan Cursor, plus “Tambahkan ke Claude Code” dengan satu klik.
- **Atau satu baris, di mana saja.** Arahkan klien MCP mana pun ke Restorm Anda yang sedang berjalan dengan `npx -y restorm-mcp` — jembatan menemukannya sendiri, tanpa port atau token yang perlu disalin.
- **Plugin untuk Claude Code.** Jalankan `/plugin marketplace add Monsieur-Dev/restorm`, lalu pasang plugin `restorm`.

Lihat [Menghubungkan asisten AI Anda](https://restorm.app/en/docs/outils/mcp/).

## v1.1.2

**Dukungan OpenAPI 3.2.**

- **Impor spesifikasi OpenAPI 3.2.** Metode `QUERY`, verba khusus (`additionalOperations`), parameter query string, dan tipe media streaming diimpor sebagai permintaan yang siap dijalankan.
- **Telusuri berkas untuk diimpor.** Tombol Telusuri di dialog impor membuka pemilih berkas asli — tidak perlu lagi mengetik atau menyeret jalur.
- **Tampilan terbagi untuk tempelan besar.** Menempel spesifikasi multi-baris membuka editor kode di kiri dan pratinjau di kanan, dengan pembatas yang dapat digeser.
- **Impor yang toleran.** Spesifikasi dengan beberapa `$ref` rusak mengimpor semua rute yang bisa dan menampilkan peringatan berisi apa yang terpaksa dilewati.

Perbaikan:

- Mengimpor spesifikasi yang tidak valid atau tidak terjangkau menampilkan pesan yang jelas alih-alih membuka dialog laporan kerusakan.
- Tampilan detail laporan kerusakan dapat digulir kembali.
- Latar belakang dialog tidak lagi buram.

## v1.1.1

**Perancang API kini dikendalikan dari bilah sisi.**

- **Model, enum, dan rute Anda tinggal di bilah sisi.** Tiga daftar di dalam tab menghilang — model (dengan penyusunan pewarisannya), enum, dan rute (grup dan rutenya) kini berada langsung di pohon bilah sisi. Klik kanan untuk mengganti nama, menambah submodel atau subgrup, mengklon rute, menghasilkan CRUD, atau menghapus; seret untuk menyusun ulang atau memindahkan induk — tidak pernah keluar dari desain. Setiap halaman kini hanya menampilkan detail item yang dipilih.
- **Pandangan sekilas atas model, enum, dan rute Anda.** Simpul akar setiap bagian kini mendaftar semua isinya — dan Model mendapat tab **Grafik**: diagram kelas model Anda dengan pewarisan dan referensinya. Enum menampilkan nilainya tepat di samping nama.
- **Satu tempat untuk mengganti nama.** Model, enum, atau rute diganti namanya dari judul besarnya (pensil), dan nama kosong menampilkan **“<tanpa nama>”** agar pensil selalu terjangkau — nama tidak lagi muncul dua kali di halaman.
- **Kesalahan validasi menunjuk ke item.** Ketika ada yang salah — model dan enum berbagi nama, referensi ke sesuatu yang tidak ada lagi — catatan di bagian atas model, enum, atau rute menjelaskannya.
- **Breadcrumb yang lengkap.** Jejaknya mencerminkan seluruh hierarki bilah sisi — folder › desain › bagian › grup › item — dan setiap segmen dapat diklik.
- **Pilih banyak, hapus sekaligus.** Pilih beberapa model, enum, atau rute dan hapus sekaligus, setelah konfirmasi.
- **Salin atau buka sumber templat kode dengan satu klik.** Di halaman "</> Code", mengarahkan kursor ke templat memunculkan tombol untuk menyalin URL atau path-nya dan satu untuk membukanya — repositori di peramban Anda, atau folder di disk untuk templat lokal.
- **Rute baru dimulai dengan nama.** Rute yang dibuat dari nol kini mendapat nama default, sehingga Anda bisa langsung menggantinya.
- **Tab pratinjau, seperti di editor Anda.** Satu klik kini membuka item di tab **pratinjau** yang dapat digunakan kembali (namanya ditampilkan miring); mengklik item lain menggunakan kembali tab yang sama alih-alih menumpuk yang baru. Klik dua kali, edit apa pun, atau jalankan sebuah permintaan untuk membuatnya tetap terbuka permanen. Matikan di Pengaturan › Perilaku.
- **Sematkan tab yang Anda biarkan terbuka.** Klik kanan sebuah tab lalu sematkan: tab yang disematkan tetap di depan, bertahan dari "tutup yang lain", dan diingat per proyek.
- **Lingkungan mendapat tampilan detail yang semestinya.** Buka sebuah lingkungan untuk mengganti namanya dari judulnya, menetapkan ikon dan warnanya, serta menambahkan sublingkungan — dan menu klik kanan kini menggandakan sebuah lingkungan beserta semua variabel dan sublingkungannya.

Perbaikan:

- **Memilih templat kode menutup pustaka.** "Gunakan" kini membawa Anda langsung kembali ke halaman Code.
- **Pembuatan dokumentasi tidak lagi gagal pada bidang opsional.** Membuat dokumentasi dari desain yang model atau parameternya membiarkan "required" tidak diatur tidak lagi berhenti dengan kesalahan templat.
- **Menghapus enum meminta konfirmasi dulu.** Enum kini mendapat konfirmasi yang sama seperti model dan rute.
- **Bilah sisi menampilkan pilihan Anda.** Dengan «sinkronkan bilah sisi dengan tab aktif» aktif, memilih atau membuat model, enum, atau rute akan membentangkan induknya agar tetap terlihat di pohon.
- **Tombol lingkungan tetap terbaca di warna apa pun.** Labelnya kini beralih ke teks gelap atau terang agar tetap terbaca di atas warna lingkungan, seperti tombol jalankan.
- **Klik tengah menutup file yang terbuka.** Mengklik tengah sebuah entri di daftar "Terbuka" pada bilah sisi akan menutup tabnya — dan pengaturan Perilaku baru memungkinkan Anda menyembunyikan panel itu sepenuhnya.
- **Kata-kata yang lebih jelas saat mulai dari dokumentasi.** Dalam dokumentasi API yang diimpor, tombolnya kini berbunyi "Buat permintaan baru dari dokumentasi ini."
- **Masuk berfungsi di versi Microsoft Store.** Callback protokol khusus yang dikembalikan peramban setelah Anda masuk kini dideklarasikan dalam paket Store, sehingga proses masuk selesai alih-alih kehabisan waktu.

## v1.1.0

🎉 **Restorm kini juga sebuah perancang API.** Rancang API Anda, sajikan sebagai mock live di lima protokol sekaligus, dan hasilkan kliennya — tanpa meninggalkan aplikasi, semuanya di disk Anda sendiri.

- **Perancang API visual.** Modelkan API Anda secara manual — model, enum (bernama atau inline), rute, parameter, contoh bernama, batasan, tag dan deprekasi — tanpa menulis satu baris spesifikasi pun.
- **Sajikan sebagai mock, dalam satu klik, di 5 protokol sekaligus.** Rancangan menjadi server yang menjawab dalam HTTP, GraphQL, SOAP, OData, dan gRPC secara bersamaan. Respons berasal dari contoh bernama Anda (atau data realistis yang dihasilkan dari model Anda), dengan validasi batasan, latensi tersimulasi, dan mode stateful.
- **Klien siap jalan, dihasilkan secara otomatis.** Saat mock berjalan, bagian Clients membuat permintaan nyata yang dapat dijalankan untuk setiap protokol yang diaktifkan, diarahkan ke endpoint mock. Satu klik membuka permintaan dan menghantam server — tak perlu lagi mengimpor ulang API Anda di tempat lain untuk mengujinya.
- **Hasilkan kode** dari rancangan Anda menggunakan template yang disediakan dan template kustom Anda sendiri, dirender dalam sandbox dan ditulis ke disk hanya setelah Anda mengonfirmasi. **Ekspor juga deskriptornya** (OpenAPI dan lainnya).
- **Saat mengimpor, badan permintaan terisi otomatis**: GraphQL memilih field skalar dari tipe kembalian, gRPC membentangkan pesan bersarang — permintaan berjalan apa adanya.

## v1.0.6

Perbaikan:

- **Proyek yang sangat besar kini gagal disimpan dengan pesan yang jelas alih-alih membeku.** Jika proyek menjadi terlalu besar untuk ditulis ke disk sekaligus — yang bisa terjadi setelah mengimpor skema API yang luar biasa besar — Restorm kini memberi tahu Anda dengan jelas bahwa proyek terlalu besar untuk disimpan, alih-alih macet atau gagal diam-diam.
- **Pelaporan kesalahan yang lebih jelas di balik layar.** Membatalkan dialog "Simpan sebagai" tidak lagi dicatat sebagai kesalahan, dan impor yang gagal kini melaporkan penyebab sebenarnya — sehingga masalah yang sesungguhnya lebih mudah ditemukan dan diperbaiki.

## v1.0.5

**Cookie jar — satu wadah cookie untuk tiap environment.**

- **Setiap environment menyimpan cookie-nya sendiri.** Masuk ke API dev dan API prod-mu dari dua environment, dan sesi keduanya tidak pernah bercampur — cookie yang terekam di satu environment hanya dikirim kembali di environment itu. Masa berlaku, `Path`, `Domain` beserta subdomain, `Secure`, `HttpOnly`, dan `SameSite` kini dihormati, bukan diabaikan.
- **Kenalkan Cookie jar.** Tab workbench baru — **Tampilan ▸ Cookie jar** — menampilkan cookie tiap environment yang dikelompokkan berdasarkan domain dalam panel yang dapat diciutkan: ubah nilai, hapus salah satu, bersihkan satu domain atau seluruh wadah, atau tambahkan cookie secara manual. Isinya menyegar secara langsung saat permintaanmu menyetel cookie.
- **Lihat apa yang dikirim dan diterima tiap permintaan.** Kini setiap permintaan punya tab **Cookie** di samping Respons dan Info, yang menampilkan cookie yang dikirim bersama panggilan dan cookie yang diterima kembali — termasuk cookie yang disetel pada suatu pengalihan yang tidak pernah sampai ke respons akhir. Tab itu juga ada pada respons lampau di riwayatmu.
- **Login berbasis cookie langsung berfungsi.** Permintaan yang mengembalikan `Set-Cookie` akan terekam dan diputar ulang otomatis pada panggilan terproteksi berikutnya — termasuk selama satu skenario berjalan, di mana setiap langkah berbagi wadah cookie environment yang sama.
- **Cookie bertahan seperti di peramban.** Cookie yang punya masa berlaku disimpan per proyek dan dimuat ulang saat kamu membukanya kembali; cookie sesi dibuang saat kamu memulai ulang — persis seperti yang dilakukan peramban.
- **Lebih dari sekadar REST.** GraphQL, SOAP, OData, JSON-RPC, tRPC, dan SSE kini semuanya mengirim dan menyimpan cookie, sementara WebSocket membawanya pada handshake koneksi.
- **Cookie bisa memakai variabelmu.** Ketik `{{token}}` pada cookie yang kamu tambahkan manual, dan nilainya akan di-resolve terhadap environment aktif saat permintaan dikirim.

Perbaikan:

- **Simpan-otomatis kini mencakup environment di dalam folder.** Menambahkan atau mengganti nama sub-environment langsung tersimpan dalam mode simpan-otomatis — tidak ada lagi prompt "simpan sebelum menutup?" untuk perubahan yang memang sudah semestinya ada di disk.

## v1.0.4

**Sekali masuk — semua jendela mengikuti.**

- **Akun Anda kini mengikuti Anda antar jendela.** Masuk, keluar, atau ganti paket di satu jendela Restorm, dan semua jendela lain yang terbuka langsung mengadopsinya — tanpa mulai ulang, tanpa login kedua. Dan saat Anda menyelesaikan login lewat browser, konfirmasinya kini tiba di jendela yang memintanya, bahkan dengan beberapa jendela terbuka.

Perbaikan:

- **Node kode kembali berjalan di Mac Intel** — build macOS Intel menyertakan biner esbuild yang dikompilasi untuk Apple Silicon.
- **Aksi "Jendela baru" peluncur AppImage kembali membuka jendela**, dan perintah `restorm` yang dipasang paket .deb/.rpm kembali berfungsi.
- **Startup di Windows lebih bersih** — jendela kini dimuat melalui protokol aplikasi, tanpa fallback senyap setelah galat internal di setiap peluncuran.

## v1.0.3

**Restorm berjalan di CI, tanpa FUSE.**

- **`restorm-cli` kini berjalan di runner CI dan di dalam kontainer.** Build Linux dibongkar alih-alih dipasang: FUSE, yang tidak lagi disertakan Ubuntu, tidak diperlukan lagi.

## v1.0.2

**Token CLI/CI Anda, tanpa keluar dari aplikasi.**

- **Buat, lihat, dan cabut token langsung dari Restorm** — untuk pengguna Pro dan Enterprise, dari tombol akun di bilah judul. Tidak perlu lagi bolak-balik ke dasbor demi token untuk pipeline yang sedang Anda tulis.
- **Token bisa kedaluwarsa.** Pilih masa berlaku saat membuatnya: 7 sampai 365 hari, atau tanpa kedaluwarsa seperti sebelumnya. Token kedaluwarsa ditolak sama seperti yang dicabut.
- **Organisasi Anda dapat mendelegasikan.** Administrator kini dapat mengizinkan anggota tertentu membuat token, dan secara terpisah memberi akses ke log audit, tanpa menjadikannya administrator.
- **Restorm kini terpasang langsung dari npm.** `npm i -g restorm-cli`, lalu `restorm` — aplikasi terbuka di Linux, macOS, dan Windows tanpa pemasang. Build diunduh satu kali, diverifikasi dengan checksum yang dipublikasikan, dan disimpan di cache, sehingga alur kerja tidak mengunduhnya lagi pada setiap tugas.

## v1.0.1

**Perbaikan pertama: memindahkan item di bilah samping, nama tab, dan laporan kerusakan.**

- **Memindahkan item di bilah samping tidak lagi merusak aplikasi.** Dengan mini browser, Pengaturan, atau log MCP terbuka, menyeret baris mana pun di bilah samping merobohkan antarmuka, dan hanya memulai ulang yang memulihkannya.
- **Mengganti nama item kini memperbarui setiap tab yang terbuka** — termasuk tab di panel terbagi dan tab semua jenis permintaan (gRPC, GraphQL, Redis…), yang sebelumnya menyimpan nama lamanya sampai dibuka kembali.
- **Laporan kerusakan kembali sampai ke kami.** Dengan pelaporan aktif, 1.0.0 diam-diam tidak mengirim apa pun: kerusakan yang Anda alami tidak memberi tahu kami apa-apa.
- **Ilustrasi “bahasa pemrograman” menampilkan logonya lagi.**

## v1.0.0

**Restorm 1.0 — klien API local-first, resmi dirilis.**

Restorm adalah klien desktop yang cepat dan mengutamakan mode offline untuk menguji dan menjalankan API di semua protokol utama.

- **Protokol**: REST/HTTP, GraphQL, gRPC, WebSocket, SSE, SOAP, OData, MQTT, AMQP, STOMP, Kafka, Redis, tRPC, JSON-RPC.
- **Skenario**: rangkai permintaan secara visual, percabangan/perulangan, ekstrak dan gunakan ulang nilai, jalankan tanpa antarmuka di CI.
- **Lingkungan & variabel**: `{{handlebars}}` di mana saja, secret bertipe, lingkungan per folder.
- **Impor/Ekspor**: OpenAPI, Postman, Insomnia, HAR, WSDL, GraphQL SDL, OData EDMX, curl, ekspor kode.
- **Proyek native Git**: proyek `.restorm` Anda adalah berkas biasa — kelola versi, bandingkan, dan selesaikan konflik di dalam aplikasi.
- **Local-first & privat**: semuanya berjalan di komputer Anda; firewall keluar mengawasi setiap panggilan eksternal.
- **Lintas platform**: Windows, macOS, Linux (.deb/.rpm/AppImage) + npm.

Edisi Community gratis, dengan Pro & Enterprise untuk tim.
