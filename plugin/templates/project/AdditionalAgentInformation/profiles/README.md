# Projeye özel profiller (isteğe bağlı)

Plugin `profiles/<rol>/<ad>.md` altında hazır yığın profilleri getirir (ör. `backend/dotnet`). Projeniz farklı bir yığın kullanıyorsa buraya `<ad>.md` yazın ve `team.json > roles.<rol>.profile` alanına `<ad>` verin. Aynı adda dosya varsa **bu klasördeki** kullanılır.

Bir profil şunları içermelidir: varsayılan kütüphaneler, mimari/kod konvansiyonları, build/test/lint komutları, rolün serbest komut listesi, DoD'deki yığına özgü maddeler, önerilen proje skill'leri.
