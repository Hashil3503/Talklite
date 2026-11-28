-- 테스트 전용 DB: 테스트가 개발용 talklite DB의 데이터를 지우지 않도록 분리
CREATE DATABASE IF NOT EXISTS talklite_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON talklite_test.* TO 'talklite'@'%';
FLUSH PRIVILEGES;
