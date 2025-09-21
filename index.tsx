import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Initialize the Google Gemini AI client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const LANGUAGES = [
    { name: 'English (US)', code: 'en-US' },
    { name: 'English (UK)', code: 'en-GB' },
    { name: 'Español (España)', code: 'es-ES' },
    { name: 'Español (México)', code: 'es-MX' },
    { name: 'Français (France)', code: 'fr-FR' },
    { name: 'Deutsch (Deutschland)', code: 'de-DE' },
    { name: 'Italiano (Italia)', code: 'it-IT' },
    { name: '日本語 (日本)', code: 'ja-JP' },
    { name: '한국어 (대한민국)', code: 'ko-KR' },
    { name: 'Português (Brasil)', code: 'pt-BR' },
    { name: 'Русский (Россия)', code: 'ru-RU' },
    { name: '中文 (中国大陆)', code: 'zh-CN' },
    { name: 'हिन्दी (भारत)', code: 'hi-IN' },
    { name: 'Hindi (Roman Script)', code: 'hi-Latn-IN' },
    { name: 'Hinglish (en-IN)', code: 'en-IN' },
];

const App = () => {
    // Core states
    const [script, setScript] = useState('');
    const [pronunciations, setPronunciations] = useState('');
    const [pronunciationMap, setPronunciationMap] = useState(new Map());
    const [lines, setLines] = useState<{ character: string; dialogue: string; direction: string; }[]>([]);
    const [characters, setCharacters] = useState([]);
    const [selectedCharacter, setSelectedCharacter] = useState('');
    const [isPracticing, setIsPracticing] = useState(false);
    const [currentLineIndex, setCurrentLineIndex] = useState(0);
    const [status, setStatus] = useState('');
    const [transcript, setTranscript] = useState('');
    const [error, setError] = useState('');
    
    // Settings states
    const [speechRate, setSpeechRate] = useState(1);
    const [pitch, setPitch] = useState(1);
    const [volume, setVolume] = useState(1);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [characterVoices, setCharacterVoices] = useState<{ [key: string]: string }>({});
    const [selectedLang, setSelectedLang] = useState('en-US');

    // New Feature States
    const [isAccuracyCheckEnabled, setIsAccuracyCheckEnabled] = useState(true);
    const [practiceMode, setPracticeMode] = useState<'dialogue' | 'read-along'>('dialogue');
    const [isRecordAndPlaybackEnabled, setIsRecordAndPlaybackEnabled] = useState(true);
    const [loopStartLine, setLoopStartLine] = useState('');
    const [loopEndLine, setLoopEndLine] = useState('');
    const [analysisResult, setAnalysisResult] = useState('');
    const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
    const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
    const [analysisType, setAnalysisType] = useState<'character' | 'scene' | null>(null);
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
    const [accuracyReport, setAccuracyReport] = useState<{ word: string, status: 'correct' | 'incorrect' | 'missing' }[] | null>(null);
    
    // Refs
    const recognitionRef = useRef(null);
    const speechUtteranceRef = useRef(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isSpeechSupported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    const isSynthSupported = 'speechSynthesis' in window;

    // Load settings from localStorage
    useEffect(() => {
        try {
            const savedSettings = localStorage.getItem('lineLearnerSettingsV2');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                setScript(settings.script || '');
                setPronunciations(settings.pronunciations || '');
                setSelectedCharacter(settings.selectedCharacter || '');
                setCharacterVoices(settings.characterVoices || {});
                setSpeechRate(settings.speechRate || 1);
                setPitch(settings.pitch || 1);
                setVolume(settings.volume || 1);
                setSelectedLang(settings.selectedLang || 'en-US');
                setIsAccuracyCheckEnabled(settings.isAccuracyCheckEnabled ?? true);
                setPracticeMode(settings.practiceMode || 'dialogue');
                setIsRecordAndPlaybackEnabled(settings.isRecordAndPlaybackEnabled ?? true);
                setLoopStartLine(settings.loopStartLine || '');
                setLoopEndLine(settings.loopEndLine || '');
            }
        } catch (error) {
            console.error("Failed to load settings from localStorage", error);
        }
    }, []);

    // Save settings to localStorage
    useEffect(() => {
        const settings = {
            script, pronunciations, selectedCharacter, characterVoices, speechRate,
            pitch, volume, selectedLang, isAccuracyCheckEnabled, practiceMode,
            isRecordAndPlaybackEnabled, loopStartLine, loopEndLine,
        };
        localStorage.setItem('lineLearnerSettingsV2', JSON.stringify(settings));
    }, [script, pronunciations, selectedCharacter, characterVoices, speechRate, pitch, volume, selectedLang, isAccuracyCheckEnabled, practiceMode, isRecordAndPlaybackEnabled, loopStartLine, loopEndLine]);

    useEffect(() => {
        if (!isSpeechSupported || !isSynthSupported) {
            setError('Your browser does not support the Web Speech API. Please try Chrome or Safari.');
        }
    }, [isSpeechSupported, isSynthSupported]);
    
    // Voice loading logic
    useEffect(() => {
        const handleVoicesChanged = () => {
            const availableVoices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith(selectedLang.split('-')[0]));
            setVoices(availableVoices);
        };
        if (isSynthSupported) {
             handleVoicesChanged();
             window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
             return () => window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        }
    }, [isSynthSupported, selectedLang]);

    // Default voice assignment logic
    useEffect(() => {
        if (voices.length === 0) return;
        const aiCharacters = characters.filter(c => c !== selectedCharacter);
        const defaultVoiceURI = voices[0]?.voiceURI;
        if (!defaultVoiceURI) return;
        setCharacterVoices(prev => {
            const newAssignments = { ...prev };
            aiCharacters.forEach(char => {
                if (!newAssignments[char] || !voices.some(v => v.voiceURI === newAssignments[char])) {
                    newAssignments[char] = defaultVoiceURI;
                }
            });
            return newAssignments;
        });
    }, [characters, selectedCharacter, voices]);

    // Pronunciation map logic
    useEffect(() => {
        const newMap = new Map();
        pronunciations.split('\n').filter(line => line.trim() !== '').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) newMap.set(parts.shift().trim(), parts.join('=').trim());
        });
        setPronunciationMap(newMap);
    }, [pronunciations]);

    // Script parsing logic with stage direction support
    useEffect(() => {
        const lineRegex = /^([A-Z0-9\s_'-]+):\s*(?:\((.*?)\)\s*)?(.*)$/;
        const parsedLines = script.split('\n').map(line => line.trim()).filter(line => line.includes(':')).map(line => {
            const match = line.match(lineRegex);
            if (!match) {
                const [character, ...dialogueParts] = line.split(':');
                return { character: character.trim().toUpperCase(), dialogue: dialogueParts.join(':').trim(), direction: '' };
            }
            return { character: match[1].trim().toUpperCase(), direction: match[2]?.trim() || '', dialogue: match[3].trim() };
        }).filter(Boolean);
        setLines(parsedLines);
        const uniqueCharacters = Array.from(new Set(parsedLines.map(line => line.character)));
        setCharacters(uniqueCharacters);
        if (uniqueCharacters.length > 0 && !uniqueCharacters.includes(selectedCharacter)) {
            setSelectedCharacter(uniqueCharacters[0]);
        } else if (uniqueCharacters.length === 0) {
            setSelectedCharacter('');
        }
    }, [script]);

    const handleStartPractice = () => {
        if (lines.length > 0 && selectedCharacter) {
            setIsPracticing(true);
            const startIdx = (loopStartLine && parseInt(loopStartLine) > 0) ? parseInt(loopStartLine) - 1 : 0;
            setCurrentLineIndex(startIdx);
            setTranscript('');
        }
    };

    const stopAllSpeechAndRecognition = () => {
        if (recognitionRef.current) (recognitionRef.current as any).abort();
        if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
        window.speechSynthesis.cancel();
    }

    const handleStopPractice = () => {
        stopAllSpeechAndRecognition();
        setIsPracticing(false);
        setStatus('');
        setTranscript('');
    };
    
    const handleSkipLine = () => {
        stopAllSpeechAndRecognition();
        advanceLine();
    };
    
    const advanceLine = () => {
        setCurrentLineIndex(prev => {
            let nextIndex = prev + 1;
            const start = loopStartLine ? parseInt(loopStartLine) - 1 : -1;
            const end = loopEndLine ? parseInt(loopEndLine) : -1;
            if (start >= 0 && end > 0 && nextIndex >= end) {
                return start; // Loop back to the start
            }
            return nextIndex;
        });
    }

    const processLine = (index) => {
        if (index >= lines.length) {
            setStatus('Script finished!');
            setTimeout(() => handleStopPractice(), 3000);
            return;
        }
        const currentLine = lines[index];
        const isUserLine = currentLine.character === selectedCharacter;

        setRecordedAudioUrl(null);
        setAccuracyReport(null);

        if (!isUserLine || practiceMode === 'read-along') {
            setStatus(`Speaking as ${currentLine.character}...`);
            setTranscript('');
            let dialogueToSpeak = currentLine.dialogue;
            pronunciationMap.forEach((p, w) => { dialogueToSpeak = dialogueToSpeak.replace(new RegExp(`\\b${w}\\b`, 'gi'), p); });
            speechUtteranceRef.current = new SpeechSynthesisUtterance(dialogueToSpeak);
            const utterance = speechUtteranceRef.current as any;
            utterance.lang = selectedLang;
            utterance.rate = speechRate;
            utterance.pitch = pitch;
            utterance.volume = volume;
            const voiceURI = isUserLine ? voices[0]?.voiceURI : characterVoices[currentLine.character];
            if (voiceURI) utterance.voice = voices.find(v => v.voiceURI === voiceURI) || null;
            utterance.onend = () => {
                 if (isUserLine && practiceMode === 'read-along') { // User turn in read-along
                     startRecognition(); // Still listen to show transcript
                 } else {
                     advanceLine();
                 }
            };
            window.speechSynthesis.speak(utterance);
        } else { // User's turn in dialogue mode
            setStatus('Your turn. Listening...');
            startRecognition();
        }
    };

    const calculateAccuracy = (original, transcript) => {
        const originalWords = original.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        const transcriptWords = transcript.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        const report = originalWords.map(word => ({ word, status: 'missing' }));
        let tIdx = 0;
        for (let i = 0; i < report.length; i++) {
            if (tIdx < transcriptWords.length && report[i].word === transcriptWords[tIdx]) {
                report[i].status = 'correct';
                tIdx++;
            } else {
                report[i].status = 'incorrect';
            }
        }
        return report;
    };

    const startRecognition = () => {
        if (!isSpeechSupported) return;
        if (isRecordAndPlaybackEnabled) {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                mediaRecorderRef.current = new MediaRecorder(stream);
                audioChunksRef.current = [];
                mediaRecorderRef.current.ondataavailable = e => audioChunksRef.current.push(e.data);
                mediaRecorderRef.current.onstop = () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                    setRecordedAudioUrl(URL.createObjectURL(audioBlob));
                    stream.getTracks().forEach(track => track.stop());
                };
                mediaRecorderRef.current.start();
            }).catch(err => console.error("Mic access error:", err));
        }
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        const recognition = recognitionRef.current as any;
        recognition.lang = selectedLang;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
            const finalTranscript = event.results[0][0].transcript.trim();
            setTranscript(finalTranscript);
            if (isAccuracyCheckEnabled) setAccuracyReport(calculateAccuracy(lines[currentLineIndex].dialogue, finalTranscript));
        };
        recognition.onend = () => {
            if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
            if (isPracticing) setTimeout(advanceLine, 1500);
        };
        recognition.onerror = (event) => {
            console.error('Speech recognition error', event.error);
            if (event.error !== 'aborted') setStatus('Sorry, I didn\'t catch that.');
        };
        recognition.start();
    };

    useEffect(() => {
        if (isPracticing) processLine(currentLineIndex);
        return () => stopAllSpeechAndRecognition();
    }, [isPracticing, currentLineIndex]);
    
    const handleAnalysis = async (type: 'character' | 'scene') => {
        if (!script) return alert('Please paste a script first.');
        setIsLoadingAnalysis(true);
        setIsAnalysisModalOpen(true);
        setAnalysisType(type);
        setAnalysisResult('');
        let prompt = '';
        if (type === 'character') {
            if (!selectedCharacter) {
                alert('Please select a character to analyze.');
                setIsLoadingAnalysis(false); setIsAnalysisModalOpen(false);
                return;
            }
            prompt = `Based on the following script, provide a detailed character analysis for ${selectedCharacter}. Focus on their objectives, motivations, and emotional arc within this scene.\n\nSCRIPT:\n${script}`;
        } else {
            prompt = `Based on the following script, provide a concise summary of the scene. Focus on the plot, main themes, and underlying conflicts.\n\nSCRIPT:\n${script}`;
        }
        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setAnalysisResult(response.text.replace(/\n/g, '<br />'));
        } catch (err) {
            setAnalysisResult('Sorry, an error occurred while analyzing the script.');
        } finally {
            setIsLoadingAnalysis(false);
        }
    };
    
    const handleExport = () => {
        const settings = localStorage.getItem('lineLearnerSettingsV2');
        if (settings) {
            const blob = new Blob([settings], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'line-learner-session.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };
    
    const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const settings = JSON.parse(e.target?.result as string);
                    localStorage.setItem('lineLearnerSettingsV2', JSON.stringify(settings));
                    // Force reload to apply all settings from scratch
                    window.location.reload();
                } catch (err) {
                    alert('Invalid settings file.');
                }
            };
            reader.readAsText(file);
        }
    };

    const handleResetSettings = () => {
        localStorage.removeItem('lineLearnerSettingsV2');
        window.location.reload();
    };


    const renderSetup = () => (
        <div className="setup-form">
            <div className="form-group">
                <label htmlFor="script-input">Paste your script here</label>
                <p>Format: CHARACTER: (optional stage direction) Dialogue</p>
                <textarea id="script-input" className="script-input" value={script} onChange={(e) => setScript(e.target.value)} placeholder="e.g.&#10;HAMLET: (To himself) To be, or not to be..."/>
            </div>
            <div className="form-group">
                <label htmlFor="pronunciation-input">Custom Pronunciations (optional)</label>
                <p>Format: Word=Pronunciation</p>
                <textarea id="pronunciation-input" className="script-input pronunciation-input" value={pronunciations} onChange={(e) => setPronunciations(e.target.value)} placeholder="e.g.&#10;Siobhan=Shiv-awn"/>
            </div>
             <div className="form-grid">
                <div className="form-group">
                    <label>AI Script Analysis (Gemini)</label>
                    <div className="button-group">
                        <button className="btn btn-tertiary" onClick={() => handleAnalysis('character')} disabled={!selectedCharacter}>Analyze Character</button>
                        <button className="btn btn-tertiary" onClick={() => handleAnalysis('scene')} disabled={!script}>Summarize Scene</button>
                    </div>
                </div>
                 <div className="form-group">
                    <label htmlFor="language-select">Language</label>
                    <select id="language-select" className="character-select" value={selectedLang} onChange={(e) => setSelectedLang(e.target.value)}>
                        {LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
                    </select>
                </div>
            </div>
            {characters.length > 0 && (
                <div className="form-group">
                    <label htmlFor="character-select">I am playing...</label>
                    <select id="character-select" className="character-select" value={selectedCharacter} onChange={(e) => setSelectedCharacter(e.target.value)}>
                        {characters.map(char => <option key={char} value={char}>{char}</option>)}
                    </select>
                </div>
            )}
            {voices.length > 0 && characters.filter(c => c !== selectedCharacter).length > 0 && (
                <div className="form-group">
                    <label>Assign AI Voices</label>
                    <div className="voice-assignments">
                        {characters.filter(c => c !== selectedCharacter).map(char => (
                            <div key={char} className="voice-assignment-group">
                                <label htmlFor={`voice-select-${char}`}>{char}</label>
                                <select id={`voice-select-${char}`} className="character-select" value={characterVoices[char] || ''} onChange={(e) => setCharacterVoices(prev => ({...prev, [char]: e.target.value}))}>
                                    {voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="form-group">
                <label>Practice Settings</label>
                <div className="settings-grid">
                    <div className="toggle-group">
                        <label htmlFor="accuracy-check">Line Accuracy Check</label>
                        <label className="switch"><input type="checkbox" id="accuracy-check" checked={isAccuracyCheckEnabled} onChange={e => setIsAccuracyCheckEnabled(e.target.checked)} /><span className="slider round"></span></label>
                    </div>
                    <div className="toggle-group">
                        <label htmlFor="record-playback">Record My Lines</label>
                        <label className="switch"><input type="checkbox" id="record-playback" checked={isRecordAndPlaybackEnabled} onChange={e => setIsRecordAndPlaybackEnabled(e.target.checked)} /><span className="slider round"></span></label>
                    </div>
                    <div className="form-group span-2">
                        <label>Practice Mode</label>
                        <div className="button-group radio-group">
                            <button className={`btn ${practiceMode === 'dialogue' ? 'btn-primary' : 'btn-tertiary'}`} onClick={() => setPracticeMode('dialogue')}>Dialogue</button>
                            <button className={`btn ${practiceMode === 'read-along' ? 'btn-primary' : 'btn-tertiary'}`} onClick={() => setPracticeMode('read-along')}>Read-Along</button>
                        </div>
                    </div>
                    <div className="form-group">
                        <label htmlFor="loop-start">Loop Start Line</label>
                        <input type="number" id="loop-start" className="character-select" value={loopStartLine} onChange={e => setLoopStartLine(e.target.value)} placeholder="e.g. 5"/>
                    </div>
                    <div className="form-group">
                        <label htmlFor="loop-end">Loop End Line</label>
                        <input type="number" id="loop-end" className="character-select" value={loopEndLine} onChange={e => setLoopEndLine(e.target.value)} placeholder="e.g. 10"/>
                    </div>
                </div>
            </div>
            <div className="form-group">
                <label>AI Voice Controls</label>
                <div className="form-grid">
                    <div className="rate-slider-container"><label>Rate</label><input type="range" min="0.5" max="2" step="0.1" value={speechRate} onChange={(e) => setSpeechRate(parseFloat(e.target.value))} /><span className="rate-value">{speechRate.toFixed(1)}x</span></div>
                    <div className="rate-slider-container"><label>Pitch</label><input type="range" min="0" max="2" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} /><span className="rate-value">{pitch.toFixed(1)}</span></div>
                    <div className="rate-slider-container"><label>Volume</label><input type="range" min="0" max="1" step="0.1" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} /><span className="rate-value">{(volume * 100).toFixed(0)}%</span></div>
                </div>
            </div>
            <div className="main-controls">
                <button className="btn btn-tertiary" onClick={handleResetSettings}>Reset All</button>
                <button className="btn btn-tertiary" onClick={handleExport}>Export</button>
                <button className="btn btn-tertiary" onClick={() => fileInputRef.current?.click()}>Import</button>
                <input type="file" ref={fileInputRef} onChange={handleImport} style={{ display: 'none' }} accept=".json"/>
                <button className="btn btn-primary" onClick={handleStartPractice} disabled={!script || !selectedCharacter || lines.length === 0}>Start Practice</button>
            </div>
        </div>
    );

    const renderPracticeSession = () => {
        const currentLine = lines[currentLineIndex];
        if (!currentLine) return null;
        const isUserLine = currentLine.character === selectedCharacter;
        return (
            <div className="practice-layout">
                <div className="script-navigator">
                    <h4>Script Navigator</h4>
                    <ul>
                        {lines.map((line, index) => (
                            <li key={index} className={index === currentLineIndex ? 'active-line' : ''}>
                                <strong>{line.character}:</strong> {line.dialogue.substring(0, 30)}...
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="practice-session">
                    <div className={`dialogue-display ${isUserLine ? 'user-line-highlight' : ''}`}>
                        <p className="character-name">{currentLine.character}</p>
                        {currentLine.direction && <p className="stage-direction">({currentLine.direction})</p>}
                        <p className="dialogue-text">{currentLine.dialogue}</p>
                    </div>
                    <div className="status-indicator">
                        <span className={isUserLine ? 'status-listening' : 'status-speaking'}>{status}</span>
                    </div>
                    <div className="transcript-display">
                        <p><strong>Your Line:</strong> {transcript || '...'}</p>
                        {recordedAudioUrl && <audio controls src={recordedAudioUrl} className="audio-player" />}
                        {accuracyReport && (
                            <div className="accuracy-report">
                                <strong>Accuracy:</strong> {' '}
                                {accuracyReport.map((item, i) => (
                                    <span key={i} className={`word-${item.status}`}>{item.word} </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="practice-controls">
                        <button className="btn btn-tertiary" onClick={handleSkipLine}>Skip Line</button>
                        <button className="btn btn-secondary" onClick={handleStopPractice}>Stop</button>
                    </div>
                </div>
            </div>
        );
    }
    
    const renderModal = () => (
        <div className="modal-overlay" onClick={() => setIsAnalysisModalOpen(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close" onClick={() => setIsAnalysisModalOpen(false)}>&times;</button>
                <h3>AI {analysisType === 'character' ? `Analysis for ${selectedCharacter}` : 'Scene Summary'}</h3>
                {isLoadingAnalysis ? (
                    <div className="loader"></div>
                ) : (
                    <p dangerouslySetInnerHTML={{ __html: analysisResult }}></p>
                )}
            </div>
        </div>
    );

    return (
        <main className="container">
            <h1 className="title">Line Learner AI Coach</h1>
            {error && <p className="error-message">{error}</p>}
            {!isPracticing ? renderSetup() : renderPracticeSession()}
            {isAnalysisModalOpen && renderModal()}
        </main>
    );
};

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);