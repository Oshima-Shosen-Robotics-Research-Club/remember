class Quiz {
    constructor() {
        this.currentQuestionIndex = 0;
        this.questions = [];
        this.parser = null;
        this.score = 0;
        this.initializeEventListeners();
    }

    async initializeParser() {
        console.log("Initializing parser...");
        await TreeSitter.init();
        this.parser = new TreeSitter();
        const Lang = await TreeSitter.Language.load('https://unpkg.com/tree-sitter-wasms/out/tree-sitter-cpp.wasm');
        console.log("Language loaded:", Lang);
        this.parser.setLanguage(Lang);
        console.log("Parser initialized:", this.parser);
    }

    async fetchAndParseCode(url) {
        console.log("Fetching and parsing code from:", url);
        const response = await fetch(url);
        const code = await response.text();
        console.log("Code fetched:\n", code);

        const tree = this.parser.parse(code);
        console.log("Code parsed:", tree);
        return tree;
    }

    createNodeArray(node) {
        const nodeArray = [];
        const traverse = (node, indent = 0) => {
            console.log(' '.repeat(indent * 2), `type: ${node.type}, text: ${node.text}`);
            nodeArray.push(node);
            for (let i = 0; i < node.childCount; i++) {
                traverse(node.child(i), indent + 1);
            }
        };
        traverse(node);
        return nodeArray;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    parseTextFromNode(node) {
        const comments = node.children.filter(node => node.type === 'comment').map(node => node.text);
        return node.text.replace(comments, '').replace(/>/g, '&gt;').replace(/</g, '&lt;');
    }

    createQuestion(node, question, correctOption, incorrectOptions) {
        const options = [correctOption, ...incorrectOptions];
        const shuffledOptions = this.shuffleArray(options);
        return {
            program: this.parseTextFromNode(node),
            question: question,
            correctNum: shuffledOptions.indexOf(correctOption),
            options: shuffledOptions,
        };
    }

    createIncQuestion(node) {
        if (node.type !== 'preproc_include') {
            return null;
        }

        const question = `次の #include の "" や <> を見て、『どこからプログラムを取得しているか』を選んでください。`;
        let incorrectOptions = [];
        let correctOption = '';

        if (node.child(1).type === 'system_lib_string') {
            correctOption = '『標準のライブラリがあるフォルダ』または『プロジェクト直下』からプログラムを取得している。';
            incorrectOptions.push('『インクルードを行っているファイルが位置するフォルダから見て、プログラムを取得している。');
        } else {
            correctOption = '『インクルードを行っているファイルが位置するフォルダ』からプログラムを取得している。';
            incorrectOptions.push('『標準のライブラリがあるフォルダ』または『プロジェクト直下』からプログラムを取得している。');
        }

        return this.createQuestion(node, question, correctOption, incorrectOptions);
    }

    createDefQuestion(node) {
        if (node.type !== 'preproc_def') {
            return null;
        }

        const question = `次の #define の意味を選んでください。`;
        let correctOption = `${this.parseTextFromNode(node.child(1))} という値を、${this.parseTextFromNode(node.child(2))} という名前で扱えるようにする。`;
        let incorrectOptions = [];
        incorrectOptions.push(`${this.parseTextFromNode(node.child(2))} という値を、${this.parseTextFromNode(node.child(1))} という名前で扱えるようにする。`);
        return this.createQuestion(node, question, correctOption, incorrectOptions);
    }

    createDeclQuestion(node) {
        if (node.type !== 'declaration') {
            return null;
        }

        const question = `次の変数宣言の意味を選んでください。`;
        let correctOption;
        let incorrectOptions = [];
        if (node.child(0).type === 'type_identifier') {
            correctOption = `${this.parseTextFromNode(node.child(0))} 型の変数 ${this.parseTextFromNode(node.child(1))} を宣言している。`;
            incorrectOptions.push(`${this.parseTextFromNode(node.child(1))} 型の変数 ${this.parseTextFromNode(node.child(0))} を宣言している。`);
        } else if (node.child(0).type === 'init_declarator') {
            correctOption = `${this.parseTextFromNode(node.child(0))} 型の配列 ${this.parseTextFromNode(node.child(1).child(0).child(0))} を宣言している。`;
            incorrectOptions.push(`${this.parseTextFromNode(node.child(1).child(0).child(0))} 型の配列 ${this.parseTextFromNode(node.child(0))} を宣言している。`);
        }
        else {
            correctOption = '問題の自動生成に対応していないプログラムです。';
            incorrectOptions.push('問題の自動生成に対応していないプログラムです。');
        }
        return this.createQuestion(node, question, correctOption, incorrectOptions);
    }

    showQuestion() {
        if (this.currentQuestionIndex < this.questions.length) {
            const quizContainer = document.getElementById('quiz-container');
            quizContainer.innerHTML = '<h2>問題</h2>';
            quizContainer.innerHTML += `<p>問題 ${this.currentQuestionIndex + 1} / ${this.questions.length}</p>`;
            quizContainer.innerHTML += `<p>プログラム</p><pre>${this.questions[this.currentQuestionIndex].program}</pre>`;
            quizContainer.innerHTML += this.questions[this.currentQuestionIndex].question;
            quizContainer.innerHTML += '<p>選択肢を選んでください。</p>';
            quizContainer.innerHTML += this.questions[this.currentQuestionIndex].options.map((opt, index) => `<input type="radio" name="option" value="${index}">${opt}<br>`).join('');
            document.getElementById('next-button').style.display = 'none';
            document.getElementById('check-button').style.display = 'block';
        } else {
            document.getElementById('quiz-container').innerHTML = `<p>全ての問題が終了しました。あなたのスコアは ${this.score} / ${this.questions.length} です。</p>`;
            document.getElementById('next-button').style.display = 'none';
            document.getElementById('check-button').style.display = 'none';
        }
    }

    async displayQuiz(url) {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('code-selection').style.display = 'none'; // コード選択セクションを非表示にする
        await this.initializeParser();
        const tree = await this.fetchAndParseCode(url);
        const nodes = this.createNodeArray(tree.rootNode);
        const incQuestions = nodes.map(node => this.createIncQuestion(node)).filter(q => q !== null);
        const defQuestions = nodes.map(node => this.createDefQuestion(node)).filter(q => q !== null);
        this.questions.push(...incQuestions);
        this.questions.push(...defQuestions);
        this.questions = this.shuffleArray(this.questions);
        document.getElementById('loading').style.display = 'none';
        this.showQuestion();
    }

    initializeEventListeners() {
        document.getElementById('start-quiz-button').addEventListener('click', () => {
            const selectedUrl = document.getElementById('code-url').value;
            this.currentQuestionIndex = 0;
            this.score = 0;
            this.questions = [];
            this.displayQuiz(selectedUrl);
        });

        document.getElementById('next-button').addEventListener('click', () => {
            this.currentQuestionIndex++;
            this.showQuestion();
        });

        document.getElementById('check-button').addEventListener('click', () => {
            const selectedOption = document.querySelector('input[name="option"]:checked');
            const resultMessage = document.createElement('p');
            if (selectedOption) {
                const selectedValue = parseInt(selectedOption.value, 10);
                if (selectedValue === this.questions[this.currentQuestionIndex].correctNum) {
                    this.score++;
                    resultMessage.textContent = '正解です！';
                } else {
                    const correctAnswer = this.questions[this.currentQuestionIndex].options[this.questions[this.currentQuestionIndex].correctNum];
                    resultMessage.textContent = `不正解です。正解は ${correctAnswer} です。`;
                }
            } else {
                alert('選択肢を選んでください。');
                return;
            }
            document.getElementById('quiz-container').appendChild(resultMessage);
            document.getElementById('check-button').style.display = 'none';
            document.getElementById('next-button').style.display = 'block';
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new Quiz();
});