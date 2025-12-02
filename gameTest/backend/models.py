from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
Base = declarative_base()
engine = create_engine("sqlite:///game.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, nullable=False)
    password_hash = Column(String(256), nullable=False)
    best_score = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
def init_db():
    Base.metadata.create_all(bind=engine)
