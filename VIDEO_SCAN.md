# Videodan Model Oluşturma

`Videodan Oluştur` aracı, sıfırdan kurulumu gösteren bir MagneticBlox videosunu yerel olarak baştan sona izler ve kalıcı blok eklemelerini gerçek video sırasıyla BuildSequence adımlarına dönüştürür. Video veya kareler herhangi bir sunucuya gönderilmez.

Araçta iki mod vardır:

- **Yapımı Otomatik İzle** varsayılan moddur. Sabit anları bulur, el/yerleştirme hareketlerini atlar ve kamera dolaşımını blok adımı saymaz.
- **5 Görünüş** bitmiş modeli ön, sağ, arka, sol ve üst karelerden çözmek için kullanılan manuel yedek yöntemdir.

## Önerilen çekim

1. İlk yaklaşık bir saniyede boş zemini gösterin.
2. Modeli düz, desensiz ve mat bir zeminde kurun.
3. Her bloğu yerleştirdikten sonra elinizi çekip yaklaşık bir saniye bekleyin.
4. Kamera dolaşacaksa blok yerleştirmeyi bırakın; yeni açı sabitlendikten sonra devam edin.
5. Telefonu mümkünse `1×` lenste tutun ve dijital zoom kullanmayın.
6. Güçlü gölge, renkli ortam ışığı ve parlama oluşturmamaya çalışın.

En iyi sonuç için bloklar, uygulamadaki mavi, kırmızı, sarı, yeşil, turuncu ve mor palete yakın görünmelidir. Aynı renkte yan yana duran blokların siyah çerçeveleri görünür olmalıdır.

## Kullanım

1. Üst araç çubuğundaki **Videodan Oluştur** düğmesine basın.
2. Videoyu seçin.
3. Varsayılan **Yapımı Otomatik İzle** modunda örnekleme hızını seçip **Videoyu Tara** düğmesine basın.
4. Araç önce tüm videoda sabit anları arar, ardından bu anları yüksek çözünürlükte karşılaştırır. İsterseniz **Taramayı Durdur** ile güvenli biçimde iptal edebilirsiniz.
5. Zaman çizelgesinde yapım adımlarını ve adım sayılmayan kamera dolaşımlarını kontrol edin. Bir olaya tıklamak videoyu o ana götürür.
6. Düşük güvenli satırların adım, tip, renk, yön ve koordinatlarını düzeltin veya yanlış satırı silin.
7. **Sahneye Aktar** düğmesine basın. Mevcut model tek bir geri-al adımıyla değiştirilir ve sağdaki BuildSequence JSON otomatik güncellenir.

Bitmiş model için otomatik sıra çıkarılamıyorsa **5 Görünüş** moduna geçin; videodan en az iki, tercihen beş yönlendirilmiş kare yakalayın.

## Analiz kapsamı

Otomatik yapım analiz motoru:

- videoyu süreye göre sınırlandırılmış örneklerle baştan sona tarar;
- ardışık karelerden sabit aralıkları ve geçici el hareketlerini ayırır;
- aynı renkte bitişik bir blok eklense bile önce/sonra renk farkından yeni alanı bulur;
- yatay kamera kayması ve zoom gibi bütün sahneyi etkileyen hareketleri yeni bir kamera epoch'u olarak işaretler;
- kamera görünüşü değiştiğinde bilinen blokları ankraj olarak kullanır;
- algılanan gerçek zamanları doğrudan `stepNumber` sırasına çevirir.

5 Görünüş analiz motoru ayrıca:

- palet renklerini HSV renk uzaklığıyla ayırır;
- bağlı renk bölgelerini ve ince kenar görünüşlerini bulur;
- bölgeleri uygulamadaki on blok şablonuyla karşılaştırır;
- karşılıklı görünüşleri tek blokta birleştirir;
- dik görünüşlerdeki ince kenarlardan eksik X/Z derinliğini tamamlar;
- konumları `0.5` birimlik yapım ızgarasına hizalar;
- bitmiş model için zeminden yukarı tahmini bir sıra üretir;
- her blok için güven skoru hesaplar.

## Bilinen sınırlar

- Hiçbir karede görünmeyen, modelin içinde tamamen kapalı bloklar çıkarılamaz.
- Tek görünüşten kesin derinlik hesaplanamaz. Otomatik mod X/Y düzleminde güçlüdür; Z ekseni ve blok yönü kamera pozu tam çözülemediğinde düşük güvenle işaretlenir.
- Kamera dolaşımı belirsizliği azaltır fakat blok kamera hareket ederken eklenirse olay otomatik kabul edilmez ve kullanıcı kontrolü ister.
- Çıkarma ve taşıma hareketleri mevcut BuildSequence şemasında güvenilir bir yapım komutuna dönüştürülemez; bu videolar ekleme odaklı olmalıdır.
- Benzer silüete sahip `square` ve `large-square`, gerçek ölçek bilinmeden karışabilir. Manuel ölçek ölçümü bunu çözer.
- Çok güçlü renkli ışık veya aynı renkte çerçevesiz birleşen parçalar birden fazla bloğu tek bölge gibi gösterebilir.
- Bitmiş model videosu gerçek yapım sırasını içermez; bu durumda 5 Görünüş modundaki sıra zeminden yukarı tahmin edilir.

Bu sınırlar nedeniyle düşük güvenli bloklar kullanıcı tarafından kontrol edilmeden sahneye aktarılamaz.
