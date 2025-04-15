import { useEffect, useState } from 'react';
import Gun from 'gun';
import DOMPurify from 'dompurify';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import jwt from 'jsonwebtoken';

// 複数のゲートウェイを指定して、ネットワークの安定性を向上させる
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://gun-us.herokuapp.com/gun',
  'https://gun-eu.herokuapp.com/gun'
]);

const gunUser = gun.user();

// JWT サンプル用（本来はシークレットはサーバー側に保持）
const JWT_SECRET = 'SUPER_SECRET_KEY_FOR_DEMO_ONLY';

interface PostData {
  id: string;
  text: string;
  createdAt: number;
  user?: string;
  likes?: { [key: string]: boolean };
  reports?: { [key: string]: boolean };
  governanceVotes?: { [key: string]: boolean }; // 分散型ガバナンス用投票
}

const LIKE_THRESHOLD = 1;        // いいねの単純集計例
const REPORT_THRESHOLD = 3;      // 3票以上で非表示
const GOVERNANCE_THRESHOLD = 2;  // ガバナンス投票で削除提案承認（例）

// 入力検証関数：最低文字数チェック、禁止タグ除去
const validateAndSanitizeInput = (text: string): string | false => {
  const MIN_LENGTH = 3;
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) {
    toast.error(`投稿は最低 ${MIN_LENGTH} 文字以上必要です。`);
    return false;
  }
  // サニタイジング（DOMPurify により不正なHTMLタグを除去）
  const sanitized = DOMPurify.sanitize(trimmed);
  // 例：scriptタグを含むと警告（実際は DOMPurify で除去済み）
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(sanitized)) {
    toast.error("不正な入力が含まれています。");
    return false;
  }
  return sanitized;
};

// JWT の生成（ユーザー認証後に発行する形をシミュレーション）
const generateJWT = (alias: string): string => {
  // 本来は有効期限・ペイロードを詳細に設定します
  return jwt.sign({ alias }, JWT_SECRET, { expiresIn: '1h' });
};

// JWT の検証サンプル
const verifyJWT = (token: string) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const Home = () => {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [input, setInput] = useState('');
  const [alias, setAlias] = useState('');
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  // JWT トークン（本来は Cookie 等に保存しサーバー側で検証）
  const [jwtToken, setJwtToken] = useState<string>('');

  // Gun.js で posts ノードを購読
  useEffect(() => {
    const postsRef = gun.get('posts');
    postsRef.map().on((data, key) => {
      if (data && data.text) {
        setPosts((prev) => {
          const exists = prev.find(p => p.id === key);
          if (exists) {
            return prev.map(p => (p.id === key ? { id: key, ...data } : p));
          } else {
            return [...prev, { id: key, ...data }];
          }
        });
      }
    });
  }, []);

  // 再接続・フォールバック処理のサンプル（Gun.js 標準の再接続処理も利用）
  useEffect(() => {
    gun.on('hi', () => {
      console.log('Gun: 接続確立');
    });
    gun.on('fail', () => {
      toast.warn('ネットワーク接続に問題が生じています。再接続を試みています...');
    });
  }, []);

  // 投稿処理：入力検証・サニタイズ後に投稿・トークン発行連携
  const handlePost = () => {
    if (!loggedIn) {
      toast.warn('ログインしてください。');
      return;
    }
    const sanitizedText = validateAndSanitizeInput(input);
    if (!sanitizedText) return;

    const post = {
      text: sanitizedText,
      createdAt: Date.now(),
      user: gunUser.is && gunUser.is.alias ? gunUser.is.alias : 'unknown',
      likes: {},
      reports: {},
      governanceVotes: {}
    };

    const postsRef = gun.get('posts');
    postsRef.set(post, (ack: { err?: string }) => {
      if (ack.err) {
        toast.error('投稿に失敗しました。');
      } else {
        toast.success('投稿完了！');
        // コンテンツトークン発行のサンプル（実際はスマートコントラクト連携）
        console.log(`Token minted for post ${post.createdAt}`);
      }
    });
    setInput('');
  };

  // ユーザー新規登録
  const handleSignUp = () => {
    if (alias && password) {
      gunUser.create(alias, password, (ack: { err?: string }) => {
        if (ack.err) {
          toast.error(`ユーザー作成エラー: ${ack.err}`);
        } else {
          toast.success('ユーザー作成成功！');
        }
      });
    } else {
      toast.warn('ユーザー名とパスワードを入力してください。');
    }
  };

  // ユーザーログイン：成功時に JWT 発行して内部状態に保存
  const handleLogin = () => {
    if (alias && password) {
      gunUser.auth(alias, password, (ack: { err?: string }) => {
        if (ack.err) {
          toast.error(`ログインエラー: ${ack.err}`);
        } else {
          setLoggedIn(true);
          const token = generateJWT(alias);
          setJwtToken(token);
          toast.success('ログイン成功！');
        }
      });
    } else {
      toast.warn('ユーザー名とパスワードを入力してください。');
    }
  };

  // いいね処理（同一ユーザーからの重複を防止）
  const handleLike = (postId: string) => {
    if (!loggedIn) {
      toast.warn('ログインしてください。');
      return;
    }
    const currentUser = gunUser.is && gunUser.is.alias;
    if (!currentUser) return;

    const postRef = gun.get('posts').get(postId);
    postRef.once((data: any) => {
      const likes = data.likes || {};
      if (!likes[currentUser]) {
        likes[currentUser] = true;
        postRef.put({ likes });
      } else {
        toast.info('既にいいね済みです。');
      }
    });
  };

  // 通報処理：ユーザーが投稿を通報し、閾値を超えた投稿は表示対象外にする
  const handleReport = (postId: string) => {
    if (!loggedIn) {
      toast.warn('ログインしてください。');
      return;
    }
    const currentUser = gunUser.is && gunUser.is.alias;
    if (!currentUser) return;

    const postRef = gun.get('posts').get(postId);
    postRef.once((data: any) => {
      const reports = data.reports || {};
      if (!reports[currentUser]) {
        reports[currentUser] = true;
        postRef.put({ reports });
        toast.success('通報しました。');
      } else {
        toast.info('既に通報済みです。');
      }
    });
  };

  // 分散型ガバナンス：管理者投票などにより投稿を削除候補とする例
  // ※ここでは、投稿ごとにユーザーが「削除」を投票し、一定票数を超えた場合に画面表示から除外
  const handleGovernanceVote = (postId: string) => {
    if (!loggedIn) {
      toast.warn('ログインしてください。');
      return;
    }
    const currentUser = gunUser.is && gunUser.is.alias;
    if (!currentUser) return;

    const postRef = gun.get('posts').get(postId);
    postRef.once((data: any) => {
      const votes = data.governanceVotes || {};
      if (!votes[currentUser]) {
        votes[currentUser] = true;
        postRef.put({ governanceVotes: votes });
        toast.success('ガバナンス投票を完了しました。');
      } else {
        toast.info('既に投票済みです。');
      }
    });
  };

  // 表示する投稿のフィルタ：通報票やガバナンス投票が閾値以上の場合に非表示
  const filterPosts = (posts: PostData[]) => {
    return posts.filter(post => {
      const reportCount = post.reports ? Object.keys(post.reports).length : 0;
      const governanceCount = post.governanceVotes ? Object.keys(post.governanceVotes).length : 0;
      return reportCount < REPORT_THRESHOLD && governanceCount < GOVERNANCE_THRESHOLD;
    });
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <ToastContainer />
      <h1>分散型 SNS Feed [完璧版]</h1>
      
      {/* ユーザー認証セクション */}
      {!loggedIn && (
        <div style={{ marginBottom: '2rem' }}>
          <input 
            type="text" 
            placeholder="ユーザー名"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
          />
          <input 
            type="password" 
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
          />
          <button onClick={handleSignUp} style={{ marginRight: '1rem' }}>新規登録</button>
          <button onClick={handleLogin}>ログイン</button>
        </div>
      )}
      
      {/* 投稿入力セクション */}
      <div style={{ marginBottom: '2rem' }}>
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={loggedIn ? "投稿内容を入力" : "ログイン後に投稿できます"}
          style={{ width: '100%', padding: '0.5rem' }}
          disabled={!loggedIn}
        />
        <button onClick={handlePost} style={{ margin: '1rem 0' }} disabled={!loggedIn}>
          投稿
        </button>
      </div>
      
      {/* 投稿リスト（フィルタ済み・ソート済み） */}
      <div>
        {filterPosts(posts)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(post => {
            const likeCount = post.likes ? Object.keys(post.likes).length : 0;
            const reportCount = post.reports ? Object.keys(post.reports).length : 0;
            const governanceCount = post.governanceVotes ? Object.keys(post.governanceVotes).length : 0;
            return (
              <div
                key={post.id}
                style={{ border: '1px solid #ccc', padding: '1rem', marginBottom: '1rem' }}
              >
                <p dangerouslySetInnerHTML={{ __html: post.text }}></p>
                <small>
                  {post.user || '匿名'} | {new Date(post.createdAt).toLocaleString()}
                </small>
                <div style={{ marginTop: '0.5rem' }}>
                  <button onClick={() => handleLike(post.id)} style={{ marginRight: '1rem' }}>
                    いいね ({likeCount})
                  </button>
                  <button onClick={() => handleReport(post.id)} style={{ marginRight: '1rem' }}>
                    通報 ({reportCount})
                  </button>
                  <button onClick={() => handleGovernanceVote(post.id)}>
                    管理投票 ({governanceCount})
                  </button>
                </div>
              </div>
            );
          })}
      </div>
      
      {/* 分散型ガバナンス：ここでは管理者投票の結果を別セクションで確認する例 */}
      <div style={{ marginTop: '3rem', borderTop: '2px solid #000', paddingTop: '1rem' }}>
        <h2>ガバナンス提案状況</h2>
        {/* 実運用では、投稿だけでなく別テーブル的な提案・投票機能を実装 */}
        <p>（ここでは投稿の「管理投票」集計により、一定票数を超えた投稿が削除候補となっています。）</p>
      </div>
    </div>
  );
};

export default Home;
