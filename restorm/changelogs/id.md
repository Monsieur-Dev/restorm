# Changelog

## v1.1.0

**Rancang API Anda, sajikan sebagai mock, dan hasilkan kliennya — tanpa meninggalkan Restorm.**

- **Perancang API visual.** Modelkan API Anda secara manual — model, enum, rute, contoh bernama, batasan — tanpa menulis satu baris spesifikasi pun.
- **Sajikan sebagai mock, dalam satu klik, di 5 protokol sekaligus.** Rancangan menjadi server yang menjawab dalam HTTP, GraphQL, SOAP, OData, dan gRPC secara bersamaan. Respons berasal dari contoh bernama Anda (atau data realistis yang dihasilkan dari model Anda), dengan validasi batasan, latensi tersimulasi, dan mode stateful.
- **Klien siap jalan, dihasilkan secara otomatis.** Saat mock berjalan, bagian Clients membuat permintaan nyata yang dapat dijalankan untuk setiap protokol yang diaktifkan, diarahkan ke endpoint mock. Satu klik membuka permintaan dan menghantam server — tak perlu lagi mengimpor ulang API Anda di tempat lain untuk mengujinya.
- **Ekspor deskriptor** (OpenAPI dan lainnya) dan **hasilkan kode** dari rancangan Anda, dirender dalam sandbox dan ditulis ke disk hanya setelah Anda mengonfirmasi.
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
