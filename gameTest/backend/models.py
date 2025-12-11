import os
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime

# 設置數據庫文件路徑
db_path = os.path.join(os.path.dirname(__file__), 'game.db')
engine = create_engine(f'sqlite:///{db_path}', connect_args={"check_same_thread": False})
Base = declarative_base()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # 遊戲分數
    best_height = Column(Integer, default=0) # 最高高度 (米, 整數)
    best_speed = Column(Integer, default=99999) # 最快時間 (釐秒, 99999 表示未完成)
    
    # ⭐ 新增：射擊模式分數
    best_shooting_score = Column(Integer, default=0) 

def init_db():
    Base.metadata.create_all(bind=engine)

# 執行此段代碼後，您需要重新初始化數據庫或執行遷移操作。
# 如果您是全新啟動，執行一次 init_db() 即可。