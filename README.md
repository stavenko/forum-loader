Скачиваем форум.

Как этим пользоваться:

1. Установить програмное обеспечение:
```
    $ brew install nvm
    $ brew install git
    $ nvm install 9.1
```

2. Скачать репозиторий с помощью git

    ```$ git clone https://github.com/stavenko/forum-loader;```

3. зайти в папку и настроить пакет
```
      $ cd ./forum-loader
      $ npm i
```
4. запустить скачивалку:
```    
     $ node ./index.js --output <папку куда надо все скачать>
```
Фильтрация сообщений, и их модификация происходит в файле euristics.js.
